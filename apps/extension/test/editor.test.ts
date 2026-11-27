import type { Config, ConfigEdit, Entry } from "@undoom/engine";
import { describe, expect, test } from "vitest";
import {
  addEntries,
  addTarget,
  entryForDomain,
  limitsError,
  normalizeDomain,
  removeEntry,
  removeTarget,
  saveTarget,
  setLimits,
} from "../src/lib/editor.ts";

const MIN = 60_000;
const catalog: Entry[] = [{ id: "reddit", name: "Reddit", domains: ["reddit.com", "redd.it"], packages: [] }];
const custom: Entry = { id: "custom:a", name: "news.example", domains: ["news.example"], packages: [] };
const target = (id: string, entryIds: string[]) => ({ id, name: null, entryIds, sessionMs: 5 * MIN, restMs: 60 * MIN });
const empty: ConfigEdit = { targets: [], customEntries: [] };

describe("normalizeDomain", () => {
  test.each([
    ["Example.com", "example.com"],
    ["https://www.news.example.org/path?q=1", "news.example.org"],
    ["sub.example.com.", "sub.example.com"],
    ["localhost", null],
    ["not a domain", null],
    ["", null],
  ])("%s", (input, expected) => expect(normalizeDomain(input)).toBe(expected));
});

describe("entryForDomain", () => {
  test("uses the catalog entry for a known domain", () => {
    expect(entryForDomain(catalog, empty, "redd.it", () => "x").id).toBe("reddit");
  });

  test("reuses a custom entry, or makes one", () => {
    const edit = { ...empty, customEntries: [custom] };
    expect(entryForDomain(catalog, edit, "news.example", () => "x")).toBe(custom);
    expect(entryForDomain(catalog, edit, "other.example", () => "x")).toEqual({
      id: "custom:x",
      name: "other.example",
      domains: ["other.example"],
      packages: [],
    });
  });
});

describe("addTarget", () => {
  test("adds the target and its new custom entries", () => {
    const next = addTarget(empty, target("t1", ["reddit", "custom:a"]), [catalog[0]!, custom]);
    expect(next.targets).toHaveLength(1);
    expect(next.customEntries).toEqual([custom]);
  });

  test("an entry can belong to one target only", () => {
    const edit = { ...empty, targets: [target("t1", ["reddit"])] };
    expect(() => addTarget(edit, target("t2", ["reddit"]), catalog)).toThrow("Reddit already has limits.");
  });
});

test("setLimits converts minutes", () => {
  const next = setLimits({ ...empty, targets: [target("t1", ["reddit"])] }, "t1", 10, 90);
  expect(next.targets[0]).toMatchObject({ sessionMs: 10 * MIN, restMs: 90 * MIN });
});

describe("removeTarget", () => {
  const edit: ConfigEdit = { targets: [target("t1", ["custom:a"])], customEntries: [custom] };
  const current: Config = { version: 1, targets: [{ ...target("t1", ["custom:a"]), pending: null }], customEntries: [custom] };

  test("drops custom entries nothing uses", () => {
    expect(removeTarget(edit, "t1", current, () => false)).toEqual(empty);
  });

  test("keeps a resting target's entries so it stays blocked until the rest ends", () => {
    expect(removeTarget(edit, "t1", current, () => true)).toEqual({ targets: [], customEntries: [custom] });
  });
});

test("limitsError matches the server's ranges", () => {
  expect(limitsError(5, 60)).toBeNull();
  expect(limitsError(0, 60)).toMatch(/Session/);
  expect(limitsError(24 * 60 + 1, 60)).toMatch(/Session/);
  expect(limitsError(5, 7 * 24 * 60 + 1)).toMatch(/Rest/);
  expect(limitsError(1.5, 60)).toMatch(/Session/);
  expect(limitsError(Number.NaN, 60)).toMatch(/Session/);
});

describe("group sites", () => {
  const youtube: Entry = { id: "youtube", name: "YouTube", domains: ["youtube.com"], packages: [] };
  const group = { ...target("g1", ["reddit"]), name: "Social" };
  const edit: ConfigEdit = { targets: [group, target("t2", ["youtube"])], customEntries: [] };
  const current: Config = { version: 1, targets: edit.targets.map((t) => ({ ...t, pending: null })), customEntries: [] };

  test("addEntries adds catalog and new custom entries to the group", () => {
    const next = addEntries(edit, "g1", [catalog[0]!, custom]);
    expect(next.targets[0]?.entryIds).toEqual(["reddit", "custom:a"]);
    expect(next.targets[1]).toEqual(edit.targets[1]);
    expect(next.customEntries).toEqual([custom]);
  });

  test("addEntries refuses a site that has limits elsewhere", () => {
    expect(() => addEntries(edit, "g1", [youtube])).toThrow("YouTube already has limits.");
  });

  test("removeEntry drops the site and its now-unused custom entry", () => {
    const withCustom = addEntries(edit, "g1", [custom]);
    expect(removeEntry(withCustom, "g1", "custom:a", current, () => false)).toEqual(edit);
  });

  test("removeEntry keeps the custom entry while the group rests", () => {
    const withCustom = addEntries(edit, "g1", [custom]);
    const resting: Config = { ...current, targets: withCustom.targets.map((t) => ({ ...t, pending: null })) };
    const next = removeEntry(withCustom, "g1", "custom:a", resting, (id) => id === "g1");
    expect(next.targets[0]?.entryIds).toEqual(["reddit"]);
    expect(next.customEntries).toEqual([custom]);
  });

  test("removeEntry won't empty a group", () => {
    expect(() => removeEntry(edit, "g1", "reddit", current, () => false)).toThrow(/at least one site/);
  });
});

describe("saveTarget", () => {
  const youtube: Entry = { id: "youtube", name: "YouTube", domains: ["youtube.com"], packages: [] };
  const edit: ConfigEdit = { targets: [target("t1", ["reddit", "custom:a"]), target("t2", ["youtube"])], customEntries: [custom] };
  const current: Config = { version: 1, targets: edit.targets.map((t) => ({ ...t, pending: null })), customEntries: [custom] };

  test("adds a new target like addTarget", () => {
    const fresh = { ...target("t3", ["custom:b"]), name: null };
    const entry = { ...custom, id: "custom:b" };
    expect(saveTarget(edit, fresh, [entry], current, () => false)).toEqual(addTarget(edit, fresh, [entry]));
  });

  test("updates sites, name and limits, dropping custom entries nothing uses", () => {
    const other: Entry = { id: "custom:b", name: "b.example", domains: ["b.example"], packages: [] };
    const next = { id: "t1", name: "Feeds", entryIds: ["reddit", "custom:b"], sessionMs: 10 * MIN, restMs: 2 * 60 * MIN };
    expect(saveTarget(edit, next, [catalog[0]!, other], current, () => false)).toEqual({
      targets: [next, edit.targets[1]],
      customEntries: [other],
    });
  });

  test("keeps a removed custom entry while the target rests", () => {
    const next = { ...target("t1", ["reddit"]), sessionMs: 10 * MIN };
    expect(saveTarget(edit, next, catalog, current, (id) => id === "t1").customEntries).toEqual([custom]);
  });

  test("refuses a site that has limits elsewhere", () => {
    const next = target("t1", ["reddit", "custom:a", "youtube"]);
    expect(() => saveTarget(edit, next, [catalog[0]!, custom, youtube], current, () => false)).toThrow("YouTube already has limits.");
  });
});
