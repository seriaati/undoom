export interface Limits {
  sessionMs: number;
  restMs: number;
}

/** All times are epoch milliseconds. */
export interface TargetState {
  usedMs: number;
  lastActiveAt: number | null;
  restUntil: number | null;
}

export type EngineEvent =
  | { kind: "usage"; eventId: string; startAt: number; durationMs: number }
  | { kind: "unlock"; eventId: string; at: number };

export interface Status {
  blocked: boolean;
  restUntil: number | null;
  remainingMs: number;
}

export const initialState: TargetState = { usedMs: 0, lastActiveAt: null, restUntil: null };

export function applyUsage(
  state: TargetState,
  limits: Limits,
  startAt: number,
  durationMs: number,
): TargetState {
  const lastActiveAt = Math.max(state.lastActiveAt ?? -Infinity, startAt + durationMs);

  // Usage inside a rest only happens when offline usage from several devices is
  // merged. The user wasn't actually resting, so the rest restarts after it.
  if (state.restUntil !== null && startAt < state.restUntil) {
    return { usedMs: 0, lastActiveAt, restUntil: lastActiveAt + limits.restMs };
  }

  const awayLongEnough =
    state.lastActiveAt !== null && startAt - state.lastActiveAt >= limits.restMs;
  const usedMs = (awayLongEnough ? 0 : state.usedMs) + durationMs;

  if (usedMs >= limits.sessionMs) {
    return { usedMs: 0, lastActiveAt, restUntil: lastActiveAt + limits.restMs };
  }
  return { usedMs, lastActiveAt, restUntil: null };
}

export function applyUnlock(state: TargetState): TargetState {
  return { usedMs: 0, lastActiveAt: state.lastActiveAt, restUntil: null };
}

export function status(state: TargetState, limits: Limits, now: number): Status {
  if (state.restUntil !== null && now < state.restUntil) {
    return { blocked: true, restUntil: state.restUntil, remainingMs: 0 };
  }
  const awayLongEnough = state.lastActiveAt !== null && now - state.lastActiveAt >= limits.restMs;
  const usedMs = awayLongEnough ? 0 : state.usedMs;
  return { blocked: false, restUntil: null, remainingMs: limits.sessionMs - usedMs };
}

function eventTime(event: EngineEvent): number {
  return event.kind === "usage" ? event.startAt : event.at;
}

/** Order-independent and idempotent: events are deduplicated by eventId and applied in time order. */
export function replay(
  limits: Limits,
  events: readonly EngineEvent[],
  from: TargetState = initialState,
): TargetState {
  const unique = [...new Map(events.map((e) => [e.eventId, e])).values()];
  unique.sort(
    (a, b) => eventTime(a) - eventTime(b) || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
  );
  return unique.reduce(
    (state, e) =>
      e.kind === "usage" ? applyUsage(state, limits, e.startAt, e.durationMs) : applyUnlock(state),
    from,
  );
}
export * from "./config.ts";
