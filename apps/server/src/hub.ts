import { DurableObject } from "cloudflare:workers";
import {
  applyEdit,
  applyUnlock,
  applyUsage,
  type Config,
  type ConfigEdit,
  effectiveConfig,
  type EngineEvent,
  emptyConfig,
  initialState,
  replay,
  status,
  type TargetState,
} from "@undoom/engine";
import type { SyncEvent } from "./schema.ts";

export interface Snapshot {
  config: Config;
  states: Record<string, TargetState>;
  serverTime: number;
}

const HOUR = 3_600_000;
// Events older than this are folded into a per-target base state. Rests last at most a
// week, but late offline uploads beyond two days are rare enough to apply approximately.
const EVENT_RETENTION_MS = 48 * HOUR;
const COMPACTION_INTERVAL_MS = 24 * HOUR;

interface EventRow extends Record<string, SqlStorageValue> {
  event_id: string;
  kind: string;
  time: number;
  duration_ms: number;
}

function toEngineEvent(row: EventRow): EngineEvent {
  return row.kind === "usage"
    ? { kind: "usage", eventId: row.event_id, startAt: row.time, durationMs: row.duration_ms }
    : { kind: "unlock", eventId: row.event_id, at: row.time };
}

/** One per user: the source of truth for their config and session state. */
export class UserHub extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        target_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        time INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_target_time ON events(target_id, time);
      CREATE TABLE IF NOT EXISTS base (
        target_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        until INTEGER NOT NULL
      );
    `);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async getSnapshot(): Promise<Snapshot> {
    const snapshot = this.materialize(Date.now());
    await this.scheduleAlarm(snapshot);
    return snapshot;
  }

  async putConfig(edit: ConfigEdit): Promise<Snapshot> {
    const now = Date.now();
    const current = this.materialize(now);
    const resting = (id: string) => isResting(current, id, now);
    this.saveConfig(applyEdit(current.config, edit, resting));
    return this.publish(now);
  }

  async addEvents(events: SyncEvent[]): Promise<Snapshot> {
    const now = Date.now();
    const config = this.loadConfig();
    for (const e of events) {
      const time = e.kind === "usage" ? e.startAt : e.at;
      const duration = e.kind === "usage" ? e.durationMs : 0;
      const inserted = this.sql.exec(
        "INSERT OR IGNORE INTO events (event_id, target_id, kind, time, duration_ms) VALUES (?, ?, ?, ?, ?)",
        e.eventId,
        e.targetId,
        e.kind,
        time,
        duration,
      ).rowsWritten;
      if (inserted > 0) this.applyLateEvent(config, e, time, duration);
    }
    return this.publish(now);
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "state", ...(await this.getSnapshot()) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    const lastCompaction = Number(this.getMeta("compacted_at") ?? 0);
    if (now - lastCompaction >= COMPACTION_INTERVAL_MS) {
      this.compact(now);
      this.setMeta("compacted_at", String(now));
    }
    const versionBefore = this.loadConfig().version;
    const snapshot = this.materialize(now);
    if (snapshot.config.version !== versionBefore) this.broadcast(snapshot);
    await this.scheduleAlarm(snapshot);
  }

  private async publish(now: number): Promise<Snapshot> {
    const snapshot = this.materialize(now);
    this.broadcast(snapshot);
    await this.scheduleAlarm(snapshot);
    return snapshot;
  }

  private broadcast(snapshot: Snapshot): void {
    const message = JSON.stringify({ type: "state", ...snapshot });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // The socket is closing; the client re-fetches state when it reconnects.
      }
    }
  }

  /** Computes states and applies pending changes whose rest is over, saving them as a new version. */
  private materialize(now: number): Snapshot {
    let config = this.loadConfig();
    let states = this.computeStates(config);
    const resting = (id: string) => isResting({ config, states, serverTime: now }, id, now);
    if (config.targets.some((t) => t.pending !== null && !resting(t.id))) {
      config = { ...effectiveConfig(config, resting), version: config.version + 1 };
      this.saveConfig(config);
      states = this.computeStates(config);
    }
    return { config, states, serverTime: now };
  }

  private computeStates(config: Config): Record<string, TargetState> {
    const states: Record<string, TargetState> = {};
    for (const target of config.targets) {
      const base = this.loadBase(target.id);
      const rows = this.sql
        .exec<EventRow>(
          "SELECT event_id, kind, time, duration_ms FROM events WHERE target_id = ? AND time >= ?",
          target.id,
          base.until,
        )
        .toArray();
      states[target.id] = replay(target, rows.map(toEngineEvent), base.state);
    }
    return states;
  }

  /** An event older than the compacted window can't be replayed, so it's applied to the base directly. */
  private applyLateEvent(config: Config, e: SyncEvent, time: number, duration: number): void {
    const base = this.loadBase(e.targetId);
    if (time >= base.until) return;
    const target = config.targets.find((t) => t.id === e.targetId);
    if (target === undefined) return;
    const state =
      e.kind === "usage" ? applyUsage(base.state, target, time, duration) : applyUnlock(base.state);
    this.sql.exec(
      "INSERT OR REPLACE INTO base (target_id, state, until) VALUES (?, ?, ?)",
      e.targetId,
      JSON.stringify(state),
      base.until,
    );
  }

  private compact(now: number): void {
    const cutoff = now - EVENT_RETENTION_MS;
    for (const target of this.loadConfig().targets) {
      const base = this.loadBase(target.id);
      const rows = this.sql
        .exec<EventRow>(
          "SELECT event_id, kind, time, duration_ms FROM events WHERE target_id = ? AND time >= ? AND time < ?",
          target.id,
          base.until,
          cutoff,
        )
        .toArray();
      const state = replay(target, rows.map(toEngineEvent), base.state);
      this.sql.exec(
        "INSERT OR REPLACE INTO base (target_id, state, until) VALUES (?, ?, ?)",
        target.id,
        JSON.stringify(state),
        cutoff,
      );
    }
    this.sql.exec("DELETE FROM events WHERE time < ?", cutoff);
  }

  private async scheduleAlarm(snapshot: Snapshot): Promise<void> {
    const { config, states, serverTime } = snapshot;
    let next = Number(this.getMeta("compacted_at") ?? serverTime) + COMPACTION_INTERVAL_MS;
    for (const target of config.targets) {
      const restUntil = states[target.id]?.restUntil;
      if (target.pending !== null && restUntil != null && restUntil > serverTime) {
        next = Math.min(next, restUntil);
      }
    }
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > next || current < serverTime) {
      await this.ctx.storage.setAlarm(Math.max(next, serverTime + 1000));
    }
  }

  private loadBase(targetId: string): { state: TargetState; until: number } {
    const row = this.sql
      .exec<{ state: string; until: number }>("SELECT state, until FROM base WHERE target_id = ?", targetId)
      .toArray()[0];
    return row ? { state: JSON.parse(row.state), until: row.until } : { state: initialState, until: 0 };
  }

  private loadConfig(): Config {
    const raw = this.getMeta("config");
    return raw === null ? emptyConfig : JSON.parse(raw);
  }

  private saveConfig(config: Config): void {
    this.setMeta("config", JSON.stringify(config));
  }

  private getMeta(key: string): string | null {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
  }
}

function isResting(snapshot: Snapshot, targetId: string, now: number): boolean {
  const target = snapshot.config.targets.find((t) => t.id === targetId);
  const state = snapshot.states[targetId];
  if (target === undefined || state === undefined) return false;
  return status(state, target, now).blocked;
}
