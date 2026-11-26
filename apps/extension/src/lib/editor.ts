import type { Config, ConfigEdit, Entry, TargetEdit } from "@undoom/engine";
import { MINUTE } from "./format.ts";

// The server's limits (apps/server/src/schema.ts).
export const SESSION_MINUTES = { min: 1, max: 24 * 60 };
export const REST_MINUTES = { min: 1, max: 7 * 24 * 60 };

export function limitsError(sessionMinutes: number, restMinutes: number): string | null {
  const ok = (n: number, r: { min: number; max: number }) => Number.isInteger(n) && n >= r.min && n <= r.max;
  if (!ok(sessionMinutes, SESSION_MINUTES)) return `Session must be ${SESSION_MINUTES.min}–${SESSION_MINUTES.max} whole minutes.`;
  if (!ok(restMinutes, REST_MINUTES)) return `Rest must be ${REST_MINUTES.min}–${REST_MINUTES.max} whole minutes.`;
  return null;
}

/** Accepts "example.com", "https://www.example.com/path" and the like. */
export function normalizeDomain(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (text === "") return null;
  let host: string;
  try {
    host = new URL(text.includes("://") ? text : `https://${text}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  return /^(?=.*[a-z])[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/** The catalog or custom entry for a domain, or a new custom entry. */
export function entryForDomain(
  catalog: readonly Entry[],
  edit: ConfigEdit,
  domain: string,
  newId: () => string,
): Entry {
  return (
    [...catalog, ...edit.customEntries].find((e) => e.domains.includes(domain)) ?? {
      id: `custom:${newId()}`,
      name: domain,
      domains: [domain],
      packages: [],
    }
  );
}

export function usedEntryIds(edit: ConfigEdit): Set<string> {
  return new Set(edit.targets.flatMap((t) => t.entryIds));
}

/** The custom entries after adding `entries`; each entry can belong to only one target. */
function claim(edit: ConfigEdit, entries: readonly Entry[]): Entry[] {
  const used = usedEntryIds(edit);
  const taken = entries.find((e) => used.has(e.id));
  if (taken !== undefined) throw new Error(`${taken.name} already has limits.`);
  const known = new Set(edit.customEntries.map((e) => e.id));
  return [...edit.customEntries, ...entries.filter((e) => e.id.startsWith("custom:") && !known.has(e.id))];
}

export function addTarget(edit: ConfigEdit, target: TargetEdit, entries: readonly Entry[]): ConfigEdit {
  return { targets: [...edit.targets, target], customEntries: claim(edit, entries) };
}

export function setLimits(edit: ConfigEdit, targetId: string, sessionMinutes: number, restMinutes: number): ConfigEdit {
  return {
    ...edit,
    targets: edit.targets.map((t) =>
      t.id === targetId ? { ...t, sessionMs: sessionMinutes * MINUTE, restMs: restMinutes * MINUTE } : t,
    ),
  };
}

/** Drops custom entries nothing uses. Resting targets keep matching until their rest ends, so their entries stay. */
function pruneCustomEntries(
  targets: ConfigEdit["targets"],
  customEntries: Entry[],
  current: Config,
  isResting: (targetId: string) => boolean,
): ConfigEdit {
  const used = new Set([
    ...targets.flatMap((t) => t.entryIds),
    ...current.targets.filter((t) => isResting(t.id)).flatMap((t) => t.entryIds),
  ]);
  return { targets, customEntries: customEntries.filter((e) => used.has(e.id)) };
}

export function removeTarget(
  edit: ConfigEdit,
  targetId: string,
  current: Config,
  isResting: (targetId: string) => boolean,
): ConfigEdit {
  const targets = edit.targets.filter((t) => t.id !== targetId);
  return pruneCustomEntries(targets, edit.customEntries, current, isResting);
}

/** Adds sites to a group. A site that already has limits elsewhere is refused rather than moved. */
export function addEntries(edit: ConfigEdit, targetId: string, entries: readonly Entry[]): ConfigEdit {
  const target = edit.targets.find((t) => t.id === targetId);
  if (target === undefined) throw new Error("That group no longer exists.");
  const fresh = entries.filter((e) => !target.entryIds.includes(e.id));
  return {
    targets: edit.targets.map((t) => (t.id === targetId ? { ...t, entryIds: [...t.entryIds, ...fresh.map((e) => e.id)] } : t)),
    customEntries: claim(edit, fresh),
  };
}

export function removeEntry(
  edit: ConfigEdit,
  targetId: string,
  entryId: string,
  current: Config,
  isResting: (targetId: string) => boolean,
): ConfigEdit {
  const targets = edit.targets.map((t) => {
    if (t.id !== targetId) return t;
    const entryIds = t.entryIds.filter((id) => id !== entryId);
    if (entryIds.length === 0) throw new Error("A group needs at least one site. Delete the group instead.");
    return { ...t, entryIds };
  });
  return pruneCustomEntries(targets, edit.customEntries, current, isResting);
}
