import {
  applyEdit,
  applyUsage,
  type Config,
  type ConfigEdit,
  effectiveConfig,
  type Entry,
  initialState,
  replay,
  type Status,
  status,
  type Target,
  type TargetState,
  targetsForHost,
} from "@undoom/engine";

export interface Snapshot {
  config: Config;
  states: Record<string, TargetState>;
  serverTime: number;
}

export type SyncEvent =
  | { kind: "usage"; eventId: string; targetId: string; startAt: number; durationMs: number }
  | { kind: "unlock"; eventId: string; targetId: string; at: number };

type WithoutId<E> = E extends SyncEvent ? Omit<E, "eventId"> : never;
export type NewSyncEvent = WithoutId<SyncEvent>;

/** Foreground time not yet recorded as events. Times are server time. */
export interface Segment {
  targetIds: string[];
  startAt: number;
  endAt: number;
}

export interface Device {
  snapshot: Snapshot;
  queue: SyncEvent[];
  /** A config PUT body not yet accepted by the server. */
  pendingEdit: ConfigEdit | null;
  segment: Segment | null;
}

export interface Usage {
  targetId: string;
  startAt: number;
  durationMs: number;
}

export const emptySnapshot: Snapshot = { config: { version: 0, targets: [], customEntries: [] }, states: {}, serverTime: 0 };

export const SEGMENT_MAX_MS = 10_000;
// Ticks are 1 s apart, so a longer gap means the timer was suspended, e.g. while the computer slept.
export const SEGMENT_MAX_GAP_MS = 5_000;

function targetState(d: Device, target: Target): TargetState {
  const events = d.queue.filter((e) => e.targetId === target.id);
  const state = replay(target, events, d.snapshot.states[target.id] ?? initialState);
  const seg = d.segment;
  if (seg === null || !seg.targetIds.includes(target.id) || seg.endAt <= seg.startAt) return state;
  return applyUsage(state, target, seg.startAt, seg.endAt - seg.startAt);
}

/** The config to enforce now: the snapshot, plus the unsent edit, with pending changes applied once a rest is over. */
export function currentConfig(d: Device, now: number): Config {
  const raw = d.snapshot.config;
  const resting = (id: string) => {
    const target = raw.targets.find((t) => t.id === id);
    return target !== undefined && status(targetState(d, target), target, now).blocked;
  };
  return effectiveConfig(d.pendingEdit === null ? raw : applyEdit(raw, d.pendingEdit, resting), resting);
}

export function statuses(d: Device, config: Config, now: number): Record<string, Status> {
  return Object.fromEntries(config.targets.map((t) => [t.id, status(targetState(d, t), t, now)]));
}

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname : null;
  } catch {
    return null;
  }
}

/** The blocked target a page belongs to, if any. */
export function blockingTarget(
  config: Config,
  catalog: readonly Entry[],
  current: Record<string, Status>,
  url: string,
): string | null {
  const host = hostOf(url);
  if (host === null) return null;
  return targetsForHost(config, catalog, host).find((t) => current[t.id]?.blocked)?.id ?? null;
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/**
 * Advances foreground tracking by one tick. `host` is the foreground site, or null when nothing
 * is in the foreground. Returns the new open segment and the usage that is now final.
 */
export function track(
  d: Device,
  catalog: readonly Entry[],
  host: string | null,
  now: number,
): { segment: Segment | null; usages: Usage[] } {
  const config = currentConfig(d, now);
  const before = statuses(d, config, now);
  const targetIds =
    host === null
      ? []
      : targetsForHost(config, catalog, host)
          .filter((t) => !before[t.id]?.blocked)
          .map((t) => t.id);

  const closed: Segment[] = [];
  let segment = d.segment;
  if (segment !== null && sameIds(segment.targetIds, targetIds) && now - segment.endAt <= SEGMENT_MAX_GAP_MS) {
    segment = { ...segment, endAt: now };
  } else {
    if (segment !== null) closed.push(segment);
    segment = targetIds.length > 0 ? { targetIds, startAt: now, endAt: now } : null;
  }

  if (segment !== null) {
    const after = statuses({ ...d, segment }, config, now);
    if (segment.targetIds.some((id) => after[id]?.blocked)) {
      closed.push(segment);
      segment = null;
    } else if (now - segment.startAt >= SEGMENT_MAX_MS) {
      closed.push(segment);
      segment = { targetIds, startAt: now, endAt: now };
    }
  }

  const usages = closed
    .filter((s) => s.endAt > s.startAt)
    .flatMap((s) => s.targetIds.map((targetId) => ({ targetId, startAt: s.startAt, durationMs: s.endAt - s.startAt })));
  return { segment, usages };
}

/** Drops the events the server has acknowledged. */
export function acknowledge(queue: SyncEvent[], sent: SyncEvent[]): SyncEvent[] {
  const ids = new Set(sent.map((e) => e.eventId));
  return queue.filter((e) => !ids.has(e.eventId));
}

/** Clock offset (server minus local) from a response, assuming symmetric latency. */
export function offsetFrom(serverTime: number, sentAt: number, receivedAt: number): number {
  return Math.round(serverTime - (sentAt + receivedAt) / 2);
}
