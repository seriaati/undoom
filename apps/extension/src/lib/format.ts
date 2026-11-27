import type { Entry, Limits, Status, Target } from "@undoom/engine";

export const MINUTE = 60_000;

/** A countdown such as "4:05" or "1:02:03", rounded up to the second. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A limit such as "45 min", "2 h" or "1 h 30 min". */
export function formatMinutes(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export interface Timer {
  phase: "resting" | "session" | "ready";
  /** What the big countdown shows. */
  ms: number;
  label: string;
  /** Share of the progress bar to fill, 0 to 1. */
  progress: number;
}

export function limitTimer(status: Status | undefined, target: Limits, now: number): Timer {
  if (status?.blocked && status.restUntil !== null) {
    const left = status.restUntil - now;
    return { phase: "resting", ms: left, label: "until the next session", progress: clamp(1 - left / target.restMs) };
  }
  if (status !== undefined && status.remainingMs < target.sessionMs) {
    return {
      phase: "session",
      ms: status.remainingMs,
      label: `left of ${formatMinutes(target.sessionMs)}`,
      progress: clamp(status.remainingMs / target.sessionMs),
    };
  }
  return { phase: "ready", ms: target.sessionMs, label: "per session", progress: 1 };
}

function clamp(share: number): number {
  return Math.min(1, Math.max(0, share));
}

export function targetName(target: Target, entries: readonly Entry[]): string {
  if (target.name !== null) return target.name;
  const id = target.entryIds[0] ?? "";
  return entries.find((e) => e.id === id)?.name ?? id;
}

/** The target's entries in order; ids missing from `entries` get a bare entry named after the id. */
export function targetEntries(target: Target, entries: readonly Entry[]): Entry[] {
  return target.entryIds.map((id) => entries.find((e) => e.id === id) ?? { id, name: id, domains: [], packages: [] });
}

export function pendingText(target: Target, entries: readonly Entry[]): string | null {
  const pending = target.pending;
  if (pending === null) return null;
  if (pending.kind === "delete") return "Will be removed after the current rest.";
  const removed = target.entryIds
    .filter((id) => !pending.entryIds.includes(id))
    .map((id) => entries.find((e) => e.id === id)?.name ?? id);
  const sites = removed.length > 0 ? `, removing ${removed.join(", ")}` : "";
  return `Changes apply after the current rest: session ${formatMinutes(pending.sessionMs)}, rest ${formatMinutes(pending.restMs)}${sites}.`;
}
