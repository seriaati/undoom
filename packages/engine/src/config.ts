export interface Entry {
  id: string;
  name: string;
  domains: string[];
  /** Subdomains of `domains` that belong to a different service, such as music.youtube.com. */
  excludeDomains?: string[];
  packages: string[];
}

export interface TargetSettings {
  entryIds: string[];
  sessionMs: number;
  restMs: number;
}

export type PendingChange = ({ kind: "update" } & TargetSettings) | { kind: "delete" };

export interface Target extends TargetSettings {
  id: string;
  /** null for a single-entry target; groups have a name. */
  name: string | null;
  /** A loosening change made while the target was resting. It applies when the rest ends. */
  pending: PendingChange | null;
}

export interface Config {
  version: number;
  targets: Target[];
  customEntries: Entry[];
}

export type TargetEdit = Omit<Target, "pending">;

export interface ConfigEdit {
  targets: TargetEdit[];
  customEntries: Entry[];
}

export const emptyConfig: Config = { version: 0, targets: [], customEntries: [] };

/** Applies the pending change of every target that isn't resting. */
export function effectiveConfig(config: Config, isResting: (targetId: string) => boolean): Config {
  const targets: Target[] = [];
  for (const target of config.targets) {
    const pending = target.pending;
    if (pending === null || isResting(target.id)) {
      targets.push(target);
    } else if (pending.kind === "update") {
      const { kind: _, ...settings } = pending;
      targets.push({ ...target, ...settings, pending: null });
    }
  }
  return { ...config, targets };
}

/**
 * Applies a user's edit. Targets that aren't resting take the edit as is. For a resting
 * target, tightening applies now and loosening waits for the rest to end: the target keeps
 * the stricter of old and new settings, with the edit stored as pending.
 */
export function applyEdit(
  current: Config,
  edit: ConfigEdit,
  isResting: (targetId: string) => boolean,
): Config {
  const now = effectiveConfig(current, isResting);
  const existing = new Map(now.targets.map((t) => [t.id, t]));
  const targets: Target[] = [];

  for (const next of edit.targets) {
    const old = existing.get(next.id);
    existing.delete(next.id);
    if (old === undefined || !isResting(next.id)) {
      targets.push({ ...next, pending: null });
      continue;
    }
    const strict: TargetSettings = {
      sessionMs: Math.min(old.sessionMs, next.sessionMs),
      restMs: Math.max(old.restMs, next.restMs),
      entryIds: [...new Set([...old.entryIds, ...next.entryIds])],
    };
    const loosens =
      strict.sessionMs !== next.sessionMs ||
      strict.restMs !== next.restMs ||
      strict.entryIds.length !== next.entryIds.length;
    targets.push({
      id: next.id,
      name: next.name,
      ...strict,
      pending: loosens
        ? { kind: "update", sessionMs: next.sessionMs, restMs: next.restMs, entryIds: next.entryIds }
        : null,
    });
  }

  for (const removed of existing.values()) {
    if (isResting(removed.id)) targets.push({ ...removed, pending: { kind: "delete" } });
  }

  return { version: current.version + 1, targets, customEntries: edit.customEntries };
}

export function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function targetsMatching(
  config: Config,
  catalog: readonly Entry[],
  entryMatches: (entry: Entry) => boolean,
): Target[] {
  const matched = new Set(
    [...catalog, ...config.customEntries].filter(entryMatches).map((e) => e.id),
  );
  return config.targets.filter((t) => t.entryIds.some((id) => matched.has(id)));
}

export function targetsForHost(config: Config, catalog: readonly Entry[], host: string): Target[] {
  const h = host.toLowerCase().replace(/\.$/, "");
  const excluded = (domains: string[] | undefined) => (domains ?? []).some((d) => hostMatches(h, d));
  return targetsMatching(
    config,
    catalog,
    (e) => e.domains.some((d) => hostMatches(h, d)) && !excluded(e.excludeDomains),
  );
}

export function targetsForPackage(config: Config, catalog: readonly Entry[], pkg: string): Target[] {
  return targetsMatching(config, catalog, (e) => e.packages.includes(pkg));
}

/** What the user asked for, with every pending change applied. Clients edit from this. */
export function desiredEdit(config: Config): ConfigEdit {
  const { targets, customEntries } = effectiveConfig(config, () => false);
  return { targets: targets.map(({ pending: _, ...t }) => t), customEntries };
}
