import catalog from "@undoom/catalog";
import type { CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import "@/assets/style.css";
import { Brand, Durations, KeyIcon, Pill, SettingsIcon, Tile } from "@/components/ui";
import { send, useView } from "@/lib/client";
import { formatCountdown, limitTimer, targetEntries, targetName } from "@/lib/format";

function Popup() {
  const [view] = useView();
  if (view === null) return null;

  const header = (
    <header className="popup-head">
      <Brand />
      <button className="icon-button" aria-label="Settings" title="Settings" onClick={() => void browser.runtime.openOptionsPage()}>
        <SettingsIcon />
      </button>
    </header>
  );

  if (!view.signedIn) {
    return (
      <>
        {header}
        <p>Sign in to set limits and sync them with your other devices.</p>
        <button className="primary wide" onClick={() => void send({ type: "signIn" })}>
          <KeyIcon />
          Sign in
        </button>
      </>
    );
  }

  const entries = [...catalog, ...view.config.customEntries];
  return (
    <>
      {header}
      {view.config.targets.length === 0 ? (
        <p className="muted">{view.loaded ? "No limits yet." : "Loading…"}</p>
      ) : (
        <ul className="rows">
          {view.config.targets.map((target, i) => {
            const name = targetName(target, entries);
            const timer = limitTimer(view.statuses[target.id], target, view.now);
            return (
              <li key={target.id} style={{ "--i": i } as CSSProperties}>
                <Tile entries={targetEntries(target, entries)} />
                <div className="grow">
                  <div className="name ellipsis">{name}</div>
                  <div className="muted small">
                    <Durations sessionMs={target.sessionMs} restMs={target.restMs} />
                  </div>
                </div>
                {timer.phase === "ready" ? (
                  <Pill phase="ready" iconOnly />
                ) : (
                  <span className={`count ${timer.phase}`}>{formatCountdown(timer.ms)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
