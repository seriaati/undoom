import { describe, expect, test } from "vitest";
import {
  applyEdit,
  type Config,
  type ConfigEdit,
  desiredEdit,
  effectiveConfig,
  type Entry,
  targetsForHost,
  targetsForPackage,
} from "../src/index.ts";

const MIN = 60_000;
const reddit = { id: "t1", name: null, entryIds: ["reddit"], sessionMs: 5 * MIN, restMs: 60 * MIN };
const base: Config = { version: 1, targets: [{ ...reddit, pending: null }], customEntries: [] };
const edit = (targets: ConfigEdit["targets"]): ConfigEdit => ({ targets, customEntries: [] });
const resting = () => true;
const notResting = () => false;

describe("applyEdit", () => {
  test("applies any change to a target that isn't resting", () => {
    const next = applyEdit(base, edit([{ ...reddit, sessionMs: 30 * MIN }]), notResting);
    expect(next.version).toBe(2);
    expect(next.targets[0]).toMatchObject({ sessionMs: 30 * MIN, pending: null });
  });

  test("applies tightening to a resting target immediately", () => {
    const next = applyEdit(base, edit([{ ...reddit, sessionMs: 2 * MIN, restMs: 90 * MIN }]), resting);
    expect(next.targets[0]).toMatchObject({ sessionMs: 2 * MIN, restMs: 90 * MIN, pending: null });
  });

  test("defers loosening of a resting target", () => {
    const loose = { ...reddit, sessionMs: 30 * MIN, restMs: 10 * MIN, entryIds: [] };
    const next = applyEdit(base, edit([loose]), resting);
    expect(next.targets[0]).toMatchObject({
      sessionMs: 5 * MIN,
      restMs: 60 * MIN,
      entryIds: ["reddit"],
      pending: { kind: "update", sessionMs: 30 * MIN, restMs: 10 * MIN, entryIds: [] },
    });
  });

  test("splits a mixed edit: tightening now, loosening pending", () => {
    const mixed = { ...reddit, sessionMs: 2 * MIN, restMs: 10 * MIN, entryIds: ["reddit", "x"] };
    const next = applyEdit(base, edit([mixed]), resting);
    expect(next.targets[0]).toMatchObject({
      sessionMs: 2 * MIN,
      restMs: 60 * MIN,
      entryIds: ["reddit", "x"],
      pending: { kind: "update", restMs: 10 * MIN },
    });
  });

  test("defers deleting a resting target", () => {
    const next = applyEdit(base, edit([]), resting);
    expect(next.targets[0]).toMatchObject({ id: "t1", pending: { kind: "delete" } });
    expect(applyEdit(base, edit([]), notResting).targets).toEqual([]);
  });

  test("a new edit replaces the pending change", () => {
    const first = applyEdit(base, edit([{ ...reddit, sessionMs: 30 * MIN }]), resting);
    const second = applyEdit(first, edit([{ ...reddit, sessionMs: 10 * MIN }]), resting);
    expect(second.targets[0]?.pending).toMatchObject({ sessionMs: 10 * MIN });
    const undone = applyEdit(second, edit([reddit]), resting);
    expect(undone.targets[0]?.pending).toBeNull();
  });
});

describe("effectiveConfig", () => {
  const pendingConfig = applyEdit(base, edit([{ ...reddit, sessionMs: 30 * MIN }]), resting);

  test("keeps the strict settings while resting", () => {
    expect(effectiveConfig(pendingConfig, resting).targets[0]?.sessionMs).toBe(5 * MIN);
  });

  test("applies pending changes once the rest is over", () => {
    expect(effectiveConfig(pendingConfig, notResting).targets[0]).toMatchObject({
      sessionMs: 30 * MIN,
      pending: null,
    });
    const deleting = applyEdit(base, edit([]), resting);
    expect(effectiveConfig(deleting, notResting).targets).toEqual([]);
  });

  test("desiredEdit shows what the user asked for", () => {
    expect(desiredEdit(pendingConfig).targets[0]?.sessionMs).toBe(30 * MIN);
    expect(desiredEdit(applyEdit(base, edit([]), resting)).targets).toEqual([]);
  });
});

describe("matching", () => {
  const catalog: Entry[] = [
    { id: "reddit", name: "Reddit", domains: ["reddit.com"], packages: ["com.reddit.frontpage"] },
  ];
  const config: Config = {
    ...base,
    customEntries: [{ id: "custom:1", name: "News", domains: ["news.example"], packages: [] }],
    targets: [...base.targets, { ...reddit, id: "t2", entryIds: ["custom:1"], pending: null }],
  };

  test("matches a domain and its subdomains, not lookalikes", () => {
    expect(targetsForHost(config, catalog, "reddit.com").map((t) => t.id)).toEqual(["t1"]);
    expect(targetsForHost(config, catalog, "old.Reddit.com.").map((t) => t.id)).toEqual(["t1"]);
    expect(targetsForHost(config, catalog, "notreddit.com")).toEqual([]);
    expect(targetsForHost(config, catalog, "www.news.example").map((t) => t.id)).toEqual(["t2"]);
  });

  test("skips excluded subdomains", () => {
    const catalog: Entry[] = [
      { id: "youtube", name: "YouTube", domains: ["youtube.com"], excludeDomains: ["music.youtube.com"], packages: [] },
    ];
    const config: Config = { ...base, targets: [{ ...reddit, id: "yt", entryIds: ["youtube"], pending: null }] };
    expect(targetsForHost(config, catalog, "music.youtube.com")).toEqual([]);
    expect(targetsForHost(config, catalog, "m.youtube.com").map((t) => t.id)).toEqual(["yt"]);
  });

  test("matches Android packages", () => {
    expect(targetsForPackage(config, catalog, "com.reddit.frontpage").map((t) => t.id)).toEqual(["t1"]);
    expect(targetsForPackage(config, catalog, "com.example")).toEqual([]);
  });
});
