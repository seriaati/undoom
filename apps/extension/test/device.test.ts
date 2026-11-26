import type { Config, Entry } from "@undoom/engine";
import { describe, expect, test } from "vitest";
import {
  acknowledge,
  blockingTarget,
  currentConfig,
  type Device,
  offsetFrom,
  type Segment,
  statuses,
  type SyncEvent,
  track,
} from "../src/lib/device.ts";

const MIN = 60_000;
const T0 = 1_000_000_000;
const catalog: Entry[] = [
  { id: "reddit", name: "Reddit", domains: ["reddit.com"], packages: [] },
  { id: "youtube", name: "YouTube", domains: ["youtube.com"], packages: [] },
];
const reddit = { id: "t1", name: null, entryIds: ["reddit"], sessionMs: 1 * MIN, restMs: 10 * MIN, pending: null };
const social = { id: "g1", name: "Social", entryIds: ["reddit", "youtube"], sessionMs: 5 * MIN, restMs: 10 * MIN, pending: null };

function device(config: Partial<Config>, rest: Partial<Device> = {}): Device {
  return {
    snapshot: { config: { version: 1, targets: [], customEntries: [], ...config }, states: {}, serverTime: T0 },
    queue: [],
    pendingEdit: null,
    segment: null,
    ...rest,
  };
}

/** Runs one tick per second over `seconds`, collecting events the way the background does. */
function run(d: Device, host: string | null, from: number, seconds: number) {
  let queue = d.queue;
  let segment: Segment | null = d.segment;
  for (let i = 0; i <= seconds; i++) {
    const result = track({ ...d, queue, segment }, catalog, host, from + i * 1000);
    segment = result.segment;
    queue = [
      ...queue,
      ...result.usages.map((u, j): SyncEvent => ({ kind: "usage", eventId: `d:${from + i}:${j}`, ...u })),
    ];
  }
  return { ...d, queue, segment };
}

describe("track", () => {
  test("extends a segment and records it every 10 s", () => {
    const d = run(device({ targets: [reddit] }), "www.reddit.com", T0, 25);
    expect(d.queue.map((e) => e.kind === "usage" && [e.startAt - T0, e.durationMs])).toEqual([
      [0, 10_000],
      [10_000, 10_000],
    ]);
    expect(d.segment).toEqual({ targetIds: ["t1"], startAt: T0 + 20_000, endAt: T0 + 25_000 });
    expect(statuses(d, d.snapshot.config, T0 + 25_000).t1?.remainingMs).toBe(35_000);
  });

  test("closes the segment when the foreground changes", () => {
    const d = run(run(device({ targets: [reddit] }), "reddit.com", T0, 3), "example.com", T0 + 4000, 0);
    expect(d.queue).toMatchObject([{ targetId: "t1", startAt: T0, durationMs: 3000 }]);
    expect(d.segment).toBeNull();
  });

  test("a suspended timer doesn't count the gap", () => {
    const d = run(run(device({ targets: [reddit] }), "reddit.com", T0, 3), "reddit.com", T0 + 60_000, 0);
    expect(d.queue).toMatchObject([{ startAt: T0, durationMs: 3000 }]);
    expect(d.segment).toEqual({ targetIds: ["t1"], startAt: T0 + 60_000, endAt: T0 + 60_000 });
  });

  test("records the segment and blocks when the session runs out", () => {
    const d = run(device({ targets: [reddit] }), "reddit.com", T0, 65);
    const total = d.queue.reduce((n, e) => n + (e.kind === "usage" ? e.durationMs : 0), 0);
    expect(total).toBe(60_000);
    expect(d.segment).toBeNull();
    const now = T0 + 65_000;
    const st = statuses(d, d.snapshot.config, now);
    expect(st.t1).toEqual({ blocked: true, restUntil: T0 + 60_000 + 10 * MIN, remainingMs: 0 });
    expect(blockingTarget(d.snapshot.config, catalog, st, "https://old.reddit.com/r/all")).toBe("t1");
    expect(blockingTarget(d.snapshot.config, catalog, st, "https://example.com/")).toBeNull();
  });

  test("a site in several targets counts toward each", () => {
    const youtube = { ...reddit, id: "t2", entryIds: ["youtube"] };
    const d = run(device({ targets: [youtube, social] }), "youtube.com", T0, 5);
    const now = T0 + 5000;
    const st = statuses(d, d.snapshot.config, now);
    expect(st.t2?.remainingMs).toBe(55_000);
    expect(st.g1?.remainingMs).toBe(5 * MIN - 5000);
  });

  test("nothing counts without a foreground site", () => {
    const d = run(device({ targets: [reddit] }), null, T0, 20);
    expect(d.queue).toEqual([]);
    expect(d.segment).toBeNull();
  });
});

describe("currentConfig", () => {
  test("applies an unsent edit locally", () => {
    const d = device(
      { targets: [reddit] },
      { pendingEdit: { targets: [{ ...reddit, sessionMs: 30 * MIN }], customEntries: [] } },
    );
    expect(currentConfig(d, T0).targets[0]).toMatchObject({ sessionMs: 30 * MIN, pending: null });
  });

  test("keeps a loosening edit pending while the target rests, then applies it", () => {
    const d = device(
      { targets: [reddit] },
      { pendingEdit: { targets: [{ ...reddit, sessionMs: 30 * MIN }], customEntries: [] } },
    );
    d.snapshot.states.t1 = { usedMs: 0, lastActiveAt: T0, restUntil: T0 + 10 * MIN };
    expect(currentConfig(d, T0 + MIN).targets[0]).toMatchObject({
      sessionMs: MIN,
      pending: { kind: "update", sessionMs: 30 * MIN },
    });
    expect(currentConfig(d, T0 + 10 * MIN).targets[0]).toMatchObject({ sessionMs: 30 * MIN, pending: null });
  });

  test("unlock events in the queue end the rest", () => {
    const d = device({ targets: [reddit] }, { queue: [{ kind: "unlock", eventId: "d:1", targetId: "t1", at: T0 + MIN }] });
    d.snapshot.states.t1 = { usedMs: 0, lastActiveAt: T0, restUntil: T0 + 10 * MIN };
    expect(statuses(d, d.snapshot.config, T0 + 2 * MIN).t1).toMatchObject({ blocked: false, remainingMs: MIN });
  });
});

describe("sync helpers", () => {
  test("acknowledge keeps events queued during the upload", () => {
    const e = (n: number): SyncEvent => ({ kind: "unlock", eventId: `d:${n}`, targetId: "t1", at: n });
    expect(acknowledge([e(1), e(2), e(3)], [e(1), e(2)])).toEqual([e(3)]);
  });

  test("offsetFrom assumes symmetric latency", () => {
    expect(offsetFrom(10_500, 1000, 2000)).toBe(9000);
  });
});
