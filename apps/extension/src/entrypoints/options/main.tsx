import catalog from "@undoom/catalog";
import type { ConfigEdit, Entry, Target } from "@undoom/engine";
import { type FormEvent, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/assets/style.css";
import { send, useView } from "@/lib/client";
import {
  addEntries,
  addTarget,
  entryForDomain,
  limitsError,
  normalizeDomain,
  removeEntry,
  removeTarget,
  setLimits,
  usedEntryIds,
} from "@/lib/editor";
import { formatMinutes, MINUTE, pendingText, statusText, targetName } from "@/lib/format";
import type { Request, View } from "@/lib/messages";

type Save = (edit: ConfigEdit) => void;

/** Catalog picks plus typed domains ("a.com, b.org"), deduplicated. Throws on a bad domain. */
function pickedEntries(desired: ConfigEdit, picked: string[], domains: string): Entry[] {
  const typed = domains.split(/[\s,]+/).filter(Boolean);
  const entries = [
    ...catalog.filter((e) => picked.includes(e.id)),
    ...typed.map((text) => {
      const domain = normalizeDomain(text);
      if (domain === null) throw new Error(`"${text}" isn't a domain.`);
      return entryForDomain(catalog, desired, domain, () => crypto.randomUUID());
    }),
  ];
  const unique = [...new Map(entries.map((e) => [e.id, e])).values()];
  if (unique.length === 0) throw new Error("Pick a site or type a domain.");
  return unique;
}

function GroupSites({ view, targetId, entries, edit }: { view: View; targetId: string; entries: Entry[]; edit: (change: () => ConfigEdit) => void }) {
  const [picked, setPicked] = useState("");
  const [domain, setDomain] = useState("");
  const desired = view.desired.targets.find((t) => t.id === targetId);
  if (desired === undefined) return null;
  const used = usedEntryIds(view.desired);
  const resting = (id: string) => view.statuses[id]?.blocked ?? false;

  function add(event: FormEvent) {
    event.preventDefault();
    edit(() => addEntries(view.desired, targetId, pickedEntries(view.desired, picked === "" ? [] : [picked], domain)));
    setPicked("");
    setDomain("");
  }

  return (
    <>
      <div className="row">
        {desired.entryIds.map((id) => (
          <span key={id}>
            {entries.find((e) => e.id === id)?.name ?? id}{" "}
            <button
              type="button"
              className="secondary"
              title="Remove from the group"
              onClick={() => edit(() => removeEntry(view.desired, targetId, id, view.config, resting))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <form className="row" onSubmit={add}>
        <select value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">Add a site…</option>
          {catalog
            .filter((e) => !used.has(e.id))
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
        <input placeholder="or a domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
        <button type="submit" className="secondary">
          Add to group
        </button>
      </form>
    </>
  );
}

function Limits(props: { session: number; rest: number; onChange: (session: number, rest: number) => void }) {
  return (
    <>
      <label>
        Session <input type="number" min={1} value={props.session} onChange={(e) => props.onChange(e.target.valueAsNumber, props.rest)} /> min
      </label>
      <label>
        Rest <input type="number" min={1} value={props.rest} onChange={(e) => props.onChange(props.session, e.target.valueAsNumber)} /> min
      </label>
    </>
  );
}

function TargetItem({ view, target, entries, save }: { view: View; target: Target; entries: Entry[]; save: Save }) {
  const desired = view.desired.targets.find((t) => t.id === target.id);
  const [session, setSession] = useState((desired?.sessionMs ?? target.sessionMs) / MINUTE);
  const [rest, setRest] = useState((desired?.restMs ?? target.restMs) / MINUTE);
  const [error, setError] = useState<string | null>(null);
  const status = view.statuses[target.id];
  const domains = target.entryIds.flatMap((id) => entries.find((e) => e.id === id)?.domains ?? [id]);
  const pending = pendingText(target, entries);

  function edit(change: () => ConfigEdit) {
    try {
      save(change());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function apply(event: FormEvent) {
    event.preventDefault();
    const invalid = limitsError(session, rest);
    setError(invalid);
    if (invalid === null) save(setLimits(view.desired, target.id, session, rest));
  }

  function remove() {
    const resting = (id: string) => view.statuses[id]?.blocked ?? false;
    save(removeTarget(view.desired, target.id, view.config, resting));
  }

  return (
    <li>
      <div className="row">
        <strong>{targetName(target, entries)}</strong>
        <span className="muted">{domains.join(", ")}</span>
      </div>
      <div className="muted">
        Session {formatMinutes(target.sessionMs)}, rest {formatMinutes(target.restMs)}
        {status && <span className={status.blocked ? "blocked" : undefined}> · {statusText(status, view.now)}</span>}
      </div>
      {pending && <div>{pending}</div>}
      {target.name !== null && <GroupSites view={view} targetId={target.id} entries={entries} edit={edit} />}
      {desired && (
        <form className="row" onSubmit={apply}>
          <Limits session={session} rest={rest} onChange={(s, r) => (setSession(s), setRest(r))} />
          <button type="submit">Save</button>
          <button type="button" className="secondary" onClick={remove}>
            Delete
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </li>
  );
}

function AddTarget({ view, save, group }: { view: View; save: Save; group: boolean }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [domains, setDomains] = useState("");
  const [session, setSession] = useState(15);
  const [rest, setRest] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const used = usedEntryIds(view.desired);
  const available = catalog.filter((e) => !used.has(e.id));

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const unique = pickedEntries(view.desired, picked, domains);
      if (group && name.trim() === "") throw new Error("Give the group a name.");
      const invalid = limitsError(session, rest);
      if (invalid !== null) throw new Error(invalid);
      const target = {
        id: crypto.randomUUID(),
        name: group ? name.trim() : null,
        entryIds: unique.map((e) => e.id),
        sessionMs: session * MINUTE,
        restMs: rest * MINUTE,
      };
      save(addTarget(view.desired, target, unique));
      setName("");
      setPicked([]);
      setDomains("");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <form onSubmit={submit}>
      {group ? (
        <>
          <p className="row">
            <input placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} />
          </p>
          <p className="row">
            {available.map((e) => (
              <label key={e.id}>
                <input
                  type="checkbox"
                  checked={picked.includes(e.id)}
                  onChange={(ev) => setPicked(ev.target.checked ? [...picked, e.id] : picked.filter((id) => id !== e.id))}
                />{" "}
                {e.name}
              </label>
            ))}
          </p>
          <p className="row">
            <input placeholder="Other domains, comma separated" value={domains} onChange={(e) => setDomains(e.target.value)} />
          </p>
        </>
      ) : (
        <p className="row">
          <select value={picked[0] ?? ""} onChange={(e) => setPicked(e.target.value === "" ? [] : [e.target.value])}>
            <option value="">Custom domain…</option>
            {available.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          {picked.length === 0 && (
            <input placeholder="example.com" value={domains} onChange={(e) => setDomains(e.target.value)} />
          )}
        </p>
      )}
      <p className="row">
        <Limits session={session} rest={rest} onChange={(s, r) => (setSession(s), setRest(r))} />
        <button type="submit">{group ? "Create group" : "Add"}</button>
      </p>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function Options() {
  const [view, refresh] = useView();
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
  const save: Save = (edit) => void run({ type: "saveConfig", edit });
  const entries = [...catalog, ...view.config.customEntries];

  return (
    <>
      <h1>Undoom</h1>
      {error && <p className="error">{error}</p>}
      <section>
        <h2>Account</h2>
        {view.signedIn ? (
          <div className="row">
            <span>Signed in.</span>
            <button className="secondary" disabled={busy} onClick={() => void run({ type: "addPasskey" })}>
              Add a passkey
            </button>
            <button className="secondary" disabled={busy} onClick={() => void run({ type: "signOut" })}>
              Sign out
            </button>
          </div>
        ) : (
          <>
            <p>Sign in with a passkey to set limits and sync them with your other devices.</p>
            <button disabled={busy} onClick={() => void run({ type: "signIn" })}>
              Sign in
            </button>
          </>
        )}
      </section>
      {view.signedIn && !view.loaded && <p className="muted">Loading your limits…</p>}
      {view.signedIn && view.loaded && (
        <>
          <section>
            <h2>Limits</h2>
            {view.unsynced && <p className="muted">Some changes haven't synced yet.</p>}
            {view.config.targets.length === 0 ? (
              <p className="muted">No limits yet.</p>
            ) : (
              <ul className="list">
                {view.config.targets.map((t) => (
                  <TargetItem key={`${t.id}:${view.config.version}`} view={view} target={t} entries={entries} save={save} />
                ))}
              </ul>
            )}
          </section>
          <section>
            <h2>Add a site</h2>
            <AddTarget view={view} save={save} group={false} />
          </section>
          <section>
            <h2>Add a group</h2>
            <p className="muted">Sites in a group share one session and one rest.</p>
            <AddTarget view={view} save={save} group />
          </section>
        </>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Options />);
