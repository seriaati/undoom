import catalog from "@undoom/catalog";
import type { ConfigEdit, Entry, Target } from "@undoom/engine";
import { type CSSProperties, type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/assets/style.css";
import {
  Brand,
  CheckIcon,
  CloseIcon,
  Countdown,
  Durations,
  EditIcon,
  Favicon,
  Identifiers,
  KeyIcon,
  ListIcon,
  Logo,
  LogOutIcon,
  Pill,
  PlusIcon,
  Tile,
  TrashIcon,
  UserIcon,
} from "@/components/ui";
import { send, useView } from "@/lib/client";
import {
  entryForDomain,
  isSubdomainOf,
  limitsError,
  normalizeDomain,
  removeTarget,
  saveTarget,
  usedEntryIds,
} from "@/lib/editor";
import { formatMinutes, limitTimer, MINUTE, pendingText, targetEntries, targetName } from "@/lib/format";
import type { Request, View } from "@/lib/messages";

const SESSION_PRESETS = [5, 10, 15, 30, 60];
const REST_PRESETS = [30, 60, 120, 240];

function DurationField(props: { label: string; presets: number[]; minutes: number; onChange: (minutes: number) => void }) {
  const [custom, setCustom] = useState(!props.presets.includes(props.minutes));
  return (
    <fieldset>
      <legend className="label">{props.label}</legend>
      <div className="presets">
        {props.presets.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={!custom && props.minutes === p}
            onClick={() => (setCustom(false), props.onChange(p))}
          >
            {formatMinutes(p * MINUTE)}
          </button>
        ))}
        <button type="button" className="custom" aria-pressed={custom} onClick={() => setCustom(true)}>
          Custom
        </button>
      </div>
      {custom && (
        <label className="minutes">
          <input
            type="number"
            min={1}
            aria-label={`${props.label} in minutes`}
            value={Number.isNaN(props.minutes) ? "" : props.minutes}
            onChange={(e) => props.onChange(e.target.valueAsNumber)}
          />
          min
        </label>
      )}
    </fieldset>
  );
}

/** Adds a limit when `target` is null, otherwise edits it. */
function Editor({ view, target, onSaved, onClose }: { view: View; target: Target | null; onSaved: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const desired = view.desired.targets.find((t) => t.id === target?.id);
  const known = [...catalog, ...view.desired.customEntries];
  const [chosen, setChosen] = useState<Entry[]>(() => desired?.entryIds.flatMap((id) => known.find((e) => e.id === id) ?? []) ?? []);
  const [query, setQuery] = useState("");
  const [name, setName] = useState(desired?.name ?? "");
  const [session, setSession] = useState((desired?.sessionMs ?? 15 * MINUTE) / MINUTE);
  const [rest, setRest] = useState((desired?.restMs ?? 60 * MINUTE) / MINUTE);
  const [excludes, setExcludes] = useState(desired?.excludeDomains ?? []);
  const [excludeQuery, setExcludeQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => dialog.current?.showModal(), []);

  const isResting = (id: string) => view.statuses[id]?.blocked ?? false;
  const title = target === null ? null : targetName(target, [...catalog, ...view.config.customEntries]);
  const usedElsewhere = usedEntryIds({ ...view.desired, targets: view.desired.targets.filter((t) => t.id !== target?.id) });
  const available = catalog.filter((e) => !usedElsewhere.has(e.id) && !chosen.some((c) => c.id === e.id));

  function addSite() {
    const text = query.trim();
    if (text === "") return;
    const domain = normalizeDomain(text);
    const entry =
      catalog.find((e) => e.name.toLowerCase() === text.toLowerCase()) ??
      (domain === null ? null : entryForDomain([...catalog, ...chosen], view.desired, domain, () => crypto.randomUUID()));
    if (entry === null) return setError(`"${text}" isn't a domain.`);
    if (usedElsewhere.has(entry.id)) return setError(`${entry.name} already has limits.`);
    if (!chosen.some((e) => e.id === entry.id)) setChosen([...chosen, entry]);
    setQuery("");
    setError(null);
  }

  function addExclude() {
    const text = excludeQuery.trim();
    if (text === "") return;
    const domain = normalizeDomain(text);
    if (domain === null) return setError(`"${text}" isn't a domain.`);
    if (!isSubdomainOf(chosen, domain)) return setError(`${domain} isn't a subdomain of a site in this limit.`);
    if (!excludes.includes(domain)) setExcludes([...excludes, domain]);
    setExcludeQuery("");
    setError(null);
  }

  const onEnter = (add: () => void) => (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add();
  };

  async function submit(edit: () => ConfigEdit) {
    let next: ConfigEdit;
    try {
      next = edit();
    } catch (e) {
      return setError((e as Error).message);
    }
    setBusy(true);
    const result = await send({ type: "saveConfig", edit: next });
    setBusy(false);
    onSaved();
    if (result.error === null) dialog.current?.close();
    else setError(result.error);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const group = chosen.length > 1;
    const invalid =
      chosen.length === 0
        ? "Add a site first."
        : group && name.trim() === ""
          ? "Give the group a name."
          : limitsError(session, rest);
    if (invalid !== null) return setError(invalid);
    const edit = {
      id: target?.id ?? crypto.randomUUID(),
      name: group ? name.trim() : null,
      entryIds: chosen.map((e) => e.id),
      sessionMs: session * MINUTE,
      restMs: rest * MINUTE,
      excludeDomains: excludes,
    };
    void submit(() => saveTarget(view.desired, edit, chosen, view.config, isResting));
  }

  function remove() {
    if (target !== null) void submit(() => removeTarget(view.desired, target.id, view.config, isResting));
  }

  return (
    <dialog ref={dialog} className="editor" onClose={onClose}>
      <form onSubmit={save}>
        <div className="dialog-head">
          <h2>{title === null ? "Add limit" : `Edit ${title}`}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => dialog.current?.close()}>
            <CloseIcon />
          </button>
        </div>
        {target !== null && isResting(target.id) && (
          <p className="notice">{title} is resting. Stricter limits apply right away. Looser ones start when this rest ends.</p>
        )}
        <fieldset>
          <legend className="label">Sites</legend>
          {chosen.length > 0 && (
            <div className="chips">
              {chosen.map((e) => (
                <span key={e.id} className="chip" title={[...e.domains, ...e.packages].join(", ")}>
                  <Favicon entry={e} />
                  {e.name}
                  <button type="button" aria-label={`Remove ${e.name}`} onClick={() => setChosen(chosen.filter((c) => c.id !== e.id))}>
                    <CloseIcon />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="add-site">
            <input
              list="catalog-sites"
              placeholder="Site name or domain"
              aria-label="Site name or domain"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onEnter(addSite)}
            />
            <datalist id="catalog-sites">
              {available.map((e) => (
                <option key={e.id} value={e.name} />
              ))}
            </datalist>
            <button type="button" className="outline icon-only" aria-label="Add site" title="Add site" onClick={addSite}>
              <PlusIcon />
            </button>
          </div>
        </fieldset>
        {chosen.length > 1 && (
          <div>
            <label className="label" htmlFor="limit-name">
              Name
            </label>
            <input id="limit-name" className="full" placeholder="e.g. Short videos" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="hint">These sites share one session and one rest.</p>
          </div>
        )}
        <fieldset>
          <legend className="label">Excluded sites</legend>
          {excludes.length > 0 && (
            <div className="chips">
              {excludes.map((d) => (
                <span key={d} className="chip">
                  {d}
                  <button type="button" aria-label={`Stop excluding ${d}`} onClick={() => setExcludes(excludes.filter((x) => x !== d))}>
                    <CloseIcon />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="add-site">
            <input
              placeholder="e.g. music.youtube.com"
              aria-label="Subdomain to exclude"
              value={excludeQuery}
              onChange={(e) => setExcludeQuery(e.target.value)}
              onKeyDown={onEnter(addExclude)}
            />
            <button type="button" className="outline icon-only" aria-label="Add exclusion" title="Add exclusion" onClick={addExclude}>
              <PlusIcon />
            </button>
          </div>
          <p className="hint">Subdomains that belong to a different service and shouldn't count.</p>
        </fieldset>
        <DurationField label="Session" presets={SESSION_PRESETS} minutes={session} onChange={setSession} />
        <DurationField label="Rest" presets={REST_PRESETS} minutes={rest} onChange={setRest} />
        {error && <p className="error">{error}</p>}
        <div className="dialog-foot">
          {target !== null && (
            <button type="button" className="icon-button danger" aria-label="Delete limit" title="Delete limit" disabled={busy} onClick={remove}>
              <TrashIcon />
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="outline" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            <CheckIcon />
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}

function LimitCard({
  view,
  target,
  entries,
  index,
  onEdit,
}: {
  view: View;
  target: Target;
  entries: Entry[];
  index: number;
  onEdit: () => void;
}) {
  const name = targetName(target, entries);
  const timer = limitTimer(view.statuses[target.id], target, view.now);
  const members = targetEntries(target, entries);
  const pending = pendingText(target, entries);
  const editable = view.desired.targets.some((t) => t.id === target.id);

  return (
    <article className="card" style={{ "--i": index } as CSSProperties}>
      <div className="card-top">
        <Tile entries={members} />
        <div className="grow">
          <div className="name ellipsis">{name}</div>
          {target.name !== null && <div className="muted small ellipsis">{members.map((e) => e.name).join(", ")}</div>}
        </div>
        <Pill phase={timer.phase} />
      </div>
      <Identifiers entries={members} />
      <Countdown timer={timer} />
      <div className="card-foot muted small">
        <Durations sessionMs={target.sessionMs} restMs={target.restMs} />
        {editable && (
          <button className="icon-button" aria-label={`Edit ${name}`} title="Edit" onClick={onEdit}>
            <EditIcon />
          </button>
        )}
      </div>
      {pending && <p className="muted small">{pending}</p>}
    </article>
  );
}

function Options() {
  const [view, refresh] = useView();
  const [tab, setTab] = useState<"limits" | "account">("limits");
  const [editing, setEditing] = useState<Target | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (view === null) return null;

  async function run(request: Exclude<Request, { type: "view" }>) {
    setBusy(true);
    setError(null);
    const result = await send(request);
    setBusy(false);
    setError(result.error);
    refresh();
  }

  if (!view.signedIn) {
    return (
      <main className="center">
        <div className="panel">
          <Logo size={40} />
          <h1>Sign in to Undoom</h1>
          <p className="muted">Use a passkey to set limits and keep them in sync across your devices.</p>
          {error && <p className="error">{error}</p>}
          <button className="primary wide" disabled={busy} onClick={() => void run({ type: "signIn" })}>
            <KeyIcon />
            Sign in with a passkey
          </button>
        </div>
      </main>
    );
  }

  const entries = [...catalog, ...view.config.customEntries];

  return (
    <>
      <header className="topbar">
        <Brand />
        <nav className="tabs" role="tablist">
          {(
            [
              ["limits", "Limits", <ListIcon />],
              ["account", "Account", <UserIcon />],
            ] as const
          ).map(([id, label, icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {icon}
              {label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        {view.unsynced && <span className="muted small">Some changes haven't synced yet</span>}
        <button className="primary small" disabled={!view.loaded} onClick={() => setEditing("new")}>
          <PlusIcon />
          Add limit
        </button>
      </header>
      <main key={tab} className="content" role="tabpanel">
        {error && <p className="error">{error}</p>}
        {tab === "account" ? (
          <div className="card">
            <h2>Signed in with a passkey</h2>
            <p className="muted">Add a passkey on another device or password manager so you can still sign in if you lose this one.</p>
            <div className="actions">
              <button className="outline" disabled={busy} onClick={() => void run({ type: "addPasskey" })}>
                <KeyIcon />
                Add a passkey
              </button>
              <button disabled={busy} onClick={() => void run({ type: "signOut" })}>
                <LogOutIcon />
                Sign out
              </button>
            </div>
          </div>
        ) : !view.loaded ? (
          <p className="muted">Loading your limits…</p>
        ) : view.config.targets.length === 0 ? (
          <div className="card">
            <strong>No limits yet</strong>
            <p className="muted">Add a site or app to give it short sessions with a rest in between.</p>
          </div>
        ) : (
          <div className="cards">
            {view.config.targets.map((t, i) => (
              <LimitCard key={t.id} view={view} target={t} entries={entries} index={i} onEdit={() => setEditing(t)} />
            ))}
          </div>
        )}
      </main>
      {editing !== null && (
        <Editor
          key={editing === "new" ? "new" : editing.id}
          view={view}
          target={editing === "new" ? null : editing}
          onSaved={refresh}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Options />);
