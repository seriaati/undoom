import { describe, expect, test } from "vitest";
import { parseBlockPage, blockPageUrl } from "../src/lib/block.ts";
import { formatCountdown, formatMinutes, limitTimer, pendingText, targetName } from "../src/lib/format.ts";
import { isCorrect, newQuestion } from "../src/lib/question.ts";

const MIN = 60_000;

test("formatCountdown rounds up to the second", () => {
  expect(formatCountdown(0)).toBe("0:00");
  expect(formatCountdown(-5)).toBe("0:00");
  expect(formatCountdown(4001)).toBe("0:05");
  expect(formatCountdown(65_000)).toBe("1:05");
  expect(formatCountdown(3_723_000)).toBe("1:02:03");
});

test("formatMinutes", () => {
  expect(formatMinutes(45 * MIN)).toBe("45 min");
  expect(formatMinutes(120 * MIN)).toBe("2 h");
  expect(formatMinutes(90 * MIN)).toBe("1 h 30 min");
});

describe("limitTimer", () => {
  const limits = { sessionMs: 15 * MIN, restMs: 60 * MIN };

  test("resting counts down to the next session and fills as the rest passes", () => {
    const timer = limitTimer({ blocked: true, restUntil: 45 * MIN, remainingMs: 0 }, limits, 0);
    expect(timer).toEqual({ phase: "resting", ms: 45 * MIN, label: "until the next session", progress: 0.25 });
  });

  test("in session drains with the time left", () => {
    const timer = limitTimer({ blocked: false, restUntil: null, remainingMs: 6 * MIN }, limits, 0);
    expect(timer).toEqual({ phase: "session", ms: 6 * MIN, label: "left of 15 min", progress: 0.4 });
  });

  test("ready shows a whole session", () => {
    const timer = limitTimer({ blocked: false, restUntil: null, remainingMs: 15 * MIN }, limits, 0);
    expect(timer).toEqual({ phase: "ready", ms: 15 * MIN, label: "per session", progress: 1 });
  });

  test("a rest longer than the current setting keeps the bar empty", () => {
    expect(limitTimer({ blocked: true, restUntil: 90 * MIN, remainingMs: 0 }, limits, 0).progress).toBe(0);
  });
});

test("targetName uses the group name or the entry's name", () => {
  const entries = [{ id: "reddit", name: "Reddit", domains: [], packages: [] }];
  const base = { id: "t", entryIds: ["reddit"], sessionMs: MIN, restMs: MIN, pending: null };
  expect(targetName({ ...base, name: null }, entries)).toBe("Reddit");
  expect(targetName({ ...base, name: "Social" }, entries)).toBe("Social");
});

test("pendingText", () => {
  const entries = [{ id: "reddit", name: "Reddit", domains: [], packages: [] }];
  const base = { id: "t", name: null, entryIds: ["reddit"], sessionMs: MIN, restMs: MIN };
  expect(pendingText({ ...base, pending: null }, entries)).toBeNull();
  expect(pendingText({ ...base, pending: { kind: "delete" } }, entries)).toBe("Will be removed after the current rest.");
  expect(pendingText({ ...base, pending: { kind: "update", entryIds: ["reddit"], sessionMs: 30 * MIN, restMs: 60 * MIN } }, entries)).toBe(
    "Changes apply after the current rest: session 30 min, rest 1 h.",
  );
  const group = { ...base, entryIds: ["reddit", "custom:x"] };
  expect(pendingText({ ...group, pending: { kind: "update", entryIds: ["custom:x"], sessionMs: MIN, restMs: MIN } }, entries)).toBe(
    "Changes apply after the current rest: session 1 min, rest 1 min, removing Reddit.",
  );
});

describe("block page URL", () => {
  test("round-trips the target and the original URL", () => {
    const url = blockPageUrl("moz-extension://x/blocked.html", "t1", "https://reddit.com/r/a?b=c&d");
    expect(parseBlockPage(new URL(url).search)).toEqual({ targetId: "t1", url: "https://reddit.com/r/a?b=c&d" });
  });

  test("only offers web pages as the way back", () => {
    expect(parseBlockPage("?target=t1&url=javascript:alert(1)").url).toBeNull();
  });
});

describe("question", () => {
  test("answers check out", () => {
    for (let i = 0; i < 50; i++) {
      const q = newQuestion();
      const [a, op, b] = q.text.split(" ");
      expect(q.answer).toBe(op === "×" ? Number(a) * Number(b) : Number(a) + Number(b));
      expect(isCorrect(q, ` ${q.answer} `)).toBe(true);
      expect(isCorrect(q, String(q.answer + 1))).toBe(false);
      expect(isCorrect(q, "")).toBe(false);
    }
  });
});
