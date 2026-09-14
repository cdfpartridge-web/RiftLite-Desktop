import { useEffect, useRef, useState } from "react";
import { ATLAS_DECK_SECTIONS, atlasSideboardChanges, type AtlasMatchHistory } from "../shared/atlasHistory";
import type { MatchDraft } from "../shared/types";
import "./styles/atlas-history.css";

const labels = {
  legend: "Legend",
  champion: "Champion",
  mainDeck: "Main deck",
  sideboard: "Sideboard",
  battlefields: "Battlefields",
  runes: "Runes",
};

export function AtlasHistoryDecks({
  history,
  initialGame = 1,
}: {
  history: AtlasMatchHistory;
  initialGame?: number;
}) {
  const [gameNumber, setGameNumber] = useState(initialGame);
  const [side, setSide] = useState<"me" | "opponent">("opponent");
  const [copied, setCopied] = useState(false);
  const game = history.games.find((g) => g.gameNumber === gameNumber) || history.games[0];
  const deck = game?.[side];
  const previous = history.games.find((g) => g.gameNumber === game?.gameNumber - 1);
  const changes = atlasSideboardChanges(previous?.[side], deck);
  useEffect(() => setCopied(false), [gameNumber, side]);
  if (!game || !deck) return null;
  return (
    <div className="atlas-history-decks">
      <div className="atlas-history-toolbar">
        <div className="atlas-history-segments" role="group" aria-label="Deck game">
          {history.games.map((g) => (
            <button
              type="button"
              key={g.gameNumber}
              aria-pressed={g === game}
              onClick={() => setGameNumber(g.gameNumber)}
            >
              Game {g.gameNumber}
              <small>
                {g.myPoints}–{g.opponentPoints}
              </small>
            </button>
          ))}
        </div>
        <div className="atlas-history-segments" role="group" aria-label="Deck player">
          <button type="button" aria-pressed={side === "me"} onClick={() => setSide("me")}>
            Your deck
          </button>
          <button type="button" aria-pressed={side === "opponent"} onClick={() => setSide("opponent")}>
            Opponent deck
          </button>
        </div>
      </div>
      <div className="atlas-history-title">
        <div>
          <small>ATLAS · GAME {game.gameNumber}</small>
          <h4>{side === "me" ? game.myName : game.opponentName}</h4>
        </div>
        {deck.availability === "available" ? (
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                .writeText(
                  ATLAS_DECK_SECTIONS.map(
                    (section) =>
                      `${labels[section]}:\n${deck.cards
                        .filter((c) => c.section === section)
                        .map((c) => `${c.quantity} ${c.name}`)
                        .join("\n")}`,
                  ).join("\n\n"),
                )
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }
          >
            {copied ? "Copied" : "Copy deck list"}
          </button>
        ) : null}
      </div>
      {deck.availability !== "available" ? (
        <p className="atlas-history-empty">
          {deck.availability === "private"
            ? "This player kept their deck private on Atlas."
            : "Atlas has not provided this game's deck list. You can refresh it later."}
        </p>
      ) : (
        <>
          {game.gameNumber > 1 ? (
            <section className="atlas-history-changes" aria-label="Sideboard changes">
              <h5>Changes from Game {game.gameNumber - 1}</h5>
              {changes === null ? (
                <p>The previous game's list is unavailable for comparison.</p>
              ) : changes.length ? (
                <div>
                  {changes.map((c) => (
                    <span className={c.delta > 0 ? "atlas-added" : "atlas-removed"} key={c.name}>
                      {c.delta > 0 ? "+" : "−"}
                      {Math.abs(c.delta)} {c.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p>No main-deck changes.</p>
              )}
            </section>
          ) : null}
          <div className="atlas-history-sections">
            {ATLAS_DECK_SECTIONS.map((section) => {
              const cards = deck.cards.filter((c) => c.section === section);
              if (!cards.length) return null;
              return (
                <details
                  className={`atlas-history-section atlas-history-${section}`}
                  key={`${game.gameNumber}-${side}-${section}`}
                  open={
                    section === "mainDeck" ||
                    section === "sideboard" ||
                    section === "legend" ||
                    section === "champion"
                  }
                >
                  <summary>
                    {labels[section]}
                    <span>{cards.reduce((n, c) => n + c.quantity, 0)}</span>
                  </summary>
                  <ul>
                    {cards.map((c) => (
                      <li key={c.name}>
                        <b>{c.quantity}×</b>
                        <span>{c.name}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function AtlasMatchDeckPanel({
  matchId,
  initialHistory,
}: {
  matchId: string;
  initialHistory?: AtlasMatchHistory;
}) {
  const [history, setHistory] = useState(initialHistory);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setHistory(initialHistory);
    setMessage("");
  }, [matchId, initialHistory]);
  const hasInitialHistory = Boolean(initialHistory?.games.length);
  useEffect(() => {
    if (hasInitialHistory) { setBusy(false); return; }
    let current = true;
    setBusy(true);
    void window.riftlite.refreshAtlasHistoryDecks(matchId).then((match) => {
      if (current) setHistory(match.atlasHistory);
    }).catch((error) => {
      if (current) setMessage(error instanceof Error ? error.message : "Deck import will retry when Atlas is available.");
    }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [matchId, hasInitialHistory]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Deck action failed. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="atlas-match-decks" aria-label="Match decks">
      <header>
        <div>
          <h4>Decks from this match</h4>
          <p>Each game's list, including sideboarding changes.</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const m = await window.riftlite.refreshAtlasHistoryDecks(matchId);
              setHistory(m.atlasHistory);
              setMessage("Atlas decks refreshed.");
            })
          }
        >
          {busy ? "Checking Atlas…" : history ? "Refresh" : "Try again"}
        </button>
      </header>
      {history?.games.length ? (
        <AtlasHistoryDecks history={history} />
      ) : (
        <p className="atlas-history-empty">
          {busy ? "Looking for this completed match’s deck lists…" :
            "Deck lists are saved automatically after your match while you’re signed in to Atlas. Atlas may take a moment to make them available. Private lists stay unavailable."}
        </p>
      )}
      {history?.games.length ? (
        <footer>
          <span>Saved locally. Included in private account sync when enabled.</span>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await window.riftlite.sendAtlasHistoryToReplay(matchId);
                setMessage("Decks added to your private Web Replay panel.");
              })
            }
          >
            Add to Web Replay
          </button>
        </footer>
      ) : null}
      {message ? (
        <p className="atlas-history-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

export function AtlasMatchDeckDialog({ match, onClose }: { match: MatchDraft; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="atlas-match-deck-dialog"
      aria-labelledby="atlas-match-deck-dialog-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'
        )).filter((element) => element.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }}
    >
      <header>
        <div>
          <span>MATCH DECKS</span>
          <h3 id="atlas-match-deck-dialog-title">vs {match.opponentName || "Unknown opponent"}</h3>
          <p>{match.myChampion} vs {match.opponentChampion} · {new Date(match.capturedAt).toLocaleDateString()}</p>
        </div>
        <button type="button" className="secondary" onClick={onClose} aria-label="Close match decks">Close</button>
      </header>
      <AtlasMatchDeckPanel key={match.id} matchId={match.id} initialHistory={match.atlasHistory} />
    </dialog>
  );
}
