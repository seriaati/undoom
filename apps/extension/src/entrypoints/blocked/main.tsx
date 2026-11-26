import catalog from "@undoom/catalog";
import { type FormEvent, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/assets/style.css";
import { parseBlockPage } from "@/lib/block";
import { send, useView } from "@/lib/client";
import { formatCountdown, targetName } from "@/lib/format";
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
    <form onSubmit={submit}>
      <h2>Emergency unlock</h2>
      <p className="muted">This ends the rest and starts a new session.</p>
      <div className="row">
        <label htmlFor="answer">{question.text} =</label>
        <input id="answer" inputMode="numeric" autoComplete="off" value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <button type="submit">Unlock</button>
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
  const goBack = url && <a href={url}>Go back to {new URL(url).hostname}</a>;

  if (status?.blocked && status.restUntil !== null) {
    return (
      <>
        <h1>{name} is resting</h1>
        <p>
          Back in <strong>{formatCountdown(status.restUntil - view.now)}</strong>.
        </p>
        {unlocking ? (
          <Unlock onUnlock={refresh} />
        ) : (
          <button className="secondary" onClick={() => setUnlocking(true)}>
            I need it now
          </button>
        )}
      </>
    );
  }
  return (
    <>
      <h1>{name} is open again</h1>
      <p>{goBack}</p>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Blocked />);
