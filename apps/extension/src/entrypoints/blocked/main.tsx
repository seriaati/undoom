import catalog from "@undoom/catalog";
import { type FormEvent, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/assets/style.css";
import { Brand, Countdown } from "@/components/ui";
import { parseBlockPage } from "@/lib/block";
import { send, useView } from "@/lib/client";
import { limitTimer, targetName } from "@/lib/format";
import { isCorrect, newQuestion } from "@/lib/question";

const { targetId, url } = parseBlockPage(location.search);

function Unlock({ onUnlock }: { onUnlock: () => void }) {
  const [question, setQuestion] = useState(newQuestion);
  const [answer, setAnswer] = useState("");
  const [wrong, setWrong] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (isCorrect(question, answer)) {
      void send({ type: "unlock", targetId }).then(onUnlock);
      return;
    }
    setQuestion(newQuestion());
    setAnswer("");
    setWrong(true);
  }

  return (
    <form className="unlock" onSubmit={submit}>
      <h2>Emergency unlock</h2>
      <p className="muted">This ends the rest and starts a new session.</p>
      <div className="unlock-row">
        <label htmlFor="answer">{question.text} =</label>
        <input id="answer" inputMode="numeric" autoComplete="off" value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <button type="submit" className="primary">
          Unlock
        </button>
      </div>
      {wrong && <p className="error">Not quite. Try this one.</p>}
    </form>
  );
}

function Blocked() {
  const [view, refresh] = useView();
  const [unlocking, setUnlocking] = useState(false);
  if (view === null) return null;

  const target = view.config.targets.find((t) => t.id === targetId);
  const status = view.statuses[targetId];
  const name = target ? targetName(target, [...catalog, ...view.config.customEntries]) : "This site";

  if (target && status?.blocked && status.restUntil !== null) {
    return (
      <main className="center">
        <div className="panel">
          <Brand />
          <h1>{name} is resting</h1>
          <Countdown timer={limitTimer(status, target, view.now)} />
          {unlocking ? (
            <Unlock onUnlock={refresh} />
          ) : (
            <button className="muted inline" onClick={() => setUnlocking(true)}>
              I need it now
            </button>
          )}
        </div>
      </main>
    );
  }
  return (
    <main className="center">
      <div className="panel">
        <Brand />
        <h1>{name} is open again</h1>
        {url && <a href={url}>Go back to {new URL(url).hostname}</a>}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Blocked />);
