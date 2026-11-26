import type { Entry, Status, Target } from "@undoom/engine";

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

export function statusText(s: Status, now: number): string {
  return s.blocked && s.restUntil !== null
    ? `Resting, ${formatCountdown(s.restUntil - now)} left`
    : `${formatCountdown(s.remainingMs)} left in this session`;
}

export function targetName(target: Target, entries: readonly Entry[]): string {
  if (target.name !== null) return target.name;
  const id = target.entryIds[0] ?? "";
  return entries.find((e) => e.id === id)?.name ?? id;
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
