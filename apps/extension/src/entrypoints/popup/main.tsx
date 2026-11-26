import catalog from "@undoom/catalog";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import "@/assets/style.css";
import { send, useView } from "@/lib/client";
import { statusText, targetName } from "@/lib/format";

function Popup() {
  const [view] = useView();
  if (view === null) return null;

  if (!view.signedIn) {
    return (
      <>
        <p>Sign in to sync your limits with your other devices.</p>
        <button onClick={() => void send({ type: "signIn" })}>Sign in</button>
      </>
    );
  }

  const entries = [...catalog, ...view.config.customEntries];
  return (
    <>
      {view.config.targets.length === 0 ? (
        <p className="muted">{view.loaded ? "No limits yet." : "Loading…"}</p>
      ) : (
        <ul className="list">
          {view.config.targets.map((target) => {
            const status = view.statuses[target.id];
            return (
              <li key={target.id}>
                <strong>{targetName(target, entries)}</strong>
                {status && <div className={status.blocked ? "blocked" : "muted"}>{statusText(status, view.now)}</div>}
              </li>
            );
          })}
        </ul>
      )}
      <p>
        <a href="#" onClick={() => void browser.runtime.openOptionsPage()}>
          Edit limits
        </a>
      </p>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
