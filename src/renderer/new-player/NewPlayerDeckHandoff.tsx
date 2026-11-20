import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { getNewPlayerDeckReadiness, NEW_PLAYER_DECK_BAN_UPDATE, type NewPlayerDeck, type NewPlayerDeckReadiness } from "../../shared/newPlayerDecks";

/** Recheck when a sleeping app wakes and while it stays open across the effective date. */
export function useNewPlayerDeckReadiness(deck: NewPlayerDeck): NewPlayerDeckReadiness {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const update = () => setToday(new Date());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return getNewPlayerDeckReadiness(deck, today);
}

export function NewPlayerDeckHandoff({ deck, readiness, onOpenExternal }: {
  deck: NewPlayerDeck;
  readiness: NewPlayerDeckReadiness;
  onOpenExternal: (url: string) => unknown;
}) {
  return <div className="nph-deck-handoff">
    <div className="nph-deck-first-plan" aria-label={`${deck.champion}: your first-game plan`}>
      <p><strong>Your plan</strong> {deck.gamePlan[0]}</p>
      <p><strong>Your opening hand</strong> {deck.mulligan[0]}</p>
      <p><strong>Watch out</strong> {deck.pitfalls[0]}</p>
    </div>
    <div className={`nph-deck-readiness nph-deck-readiness-${readiness.status}`} role="note" aria-label={`${deck.champion}: dated deck check`}>
      <strong>{readiness.title}</strong>
      <p>{readiness.explanation}</p>
      {readiness.affectedCards.length > 0 && <ul aria-label="Cards affected by the announced bans">{readiness.affectedCards.map(card => <li key={card.name}>{card.quantity} × {card.name}</li>)}</ul>}
      <details><summary>Check the format and region</summary>
        <p>{NEW_PLAYER_DECK_BAN_UPDATE.regionalNote}</p>
        <p>This is the saved Piltover Archive list, reviewed on 11 November. Announcement checked on 14 November 2026. The author’s page may now contain a newer version.</p>
        <button type="button" className="nph-text-button" onClick={() => void onOpenExternal(NEW_PLAYER_DECK_BAN_UPDATE.sourceUrl)}>Official ban announcement <ExternalLink size={12} /></button>
      </details>
    </div>
  </div>;
}
