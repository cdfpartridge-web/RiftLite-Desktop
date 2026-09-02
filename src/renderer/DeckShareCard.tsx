import { useEffect, useState } from "react";
import { BarChart3, Gamepad2, Sparkles } from "lucide-react";
import { ShareCardDialog } from "./ShareCardDialog";
import "./styles/deckShareCard.css";

export interface DeckShareCardViewModel {
  deckTitle: string;
  legend: string;
  sourceLabel: string;
  totalGames: number;
  decisiveGames: number;
  winRateLabel: string;
  record: string;
  artSources: string[];
}

export function deckShareCaption(deck: DeckShareCardViewModel): string {
  const gameLabel = `${deck.totalGames} ${deck.totalGames === 1 ? "game" : "games"}`;
  if (deck.decisiveGames > 0) {
    return `I'm currently playing ${deck.legend} and my win rate is ${deck.winRateLabel} after ${gameLabel}. Track all of this on RiftLite.com`;
  }
  if (deck.totalGames > 0) {
    return `I'm currently playing ${deck.legend} and I've recorded ${gameLabel} so far. Track all of this on RiftLite.com`;
  }
  return `I'm currently playing ${deck.legend} and tracking my games with RiftLite. Track all of this on RiftLite.com`;
}

export function deckShareArtSources(sources: string[], failedSources: ReadonlySet<string> = new Set()): string[] {
  const selected: string[] = [];
  const identities = new Set<string>();
  for (const rawSource of sources) {
    const source = rawSource.trim();
    if (!source || failedSources.has(source)) continue;
    const identity = deckShareArtIdentity(source);
    if (identities.has(identity)) continue;
    identities.add(identity);
    selected.push(source);
    if (selected.length === 4) break;
  }
  return selected;
}

function deckShareArtIdentity(source: string): string {
  const assetHash = source.match(/\/([a-f0-9]{40})(?:-\d+x\d+)?\.[a-z0-9]+(?:[?#]|$)/i)?.[1];
  return assetHash?.toLowerCase() ?? source.replace(/[?#].*$/, "").toLowerCase();
}

export function DeckShareCard({ deck }: { deck: DeckShareCardViewModel }) {
  const hasWinRate = deck.decisiveGames > 0;
  const gameLabel = deck.totalGames === 1 ? "Recorded game" : "Recorded games";
  const summary = hasWinRate
    ? `${deck.legend}, ${deck.winRateLabel} win rate after ${deck.totalGames} ${deck.totalGames === 1 ? "game" : "games"}`
    : `${deck.legend}, ${deck.totalGames} recorded ${deck.totalGames === 1 ? "game" : "games"}`;

  return (
    <article className="deck-share-card" data-share-size="1200x675" role="img" aria-label={`RiftLite deck summary: ${summary}`}>
      <div className="deck-share-card__grid" aria-hidden="true" />
      <div className="deck-share-card__glow" aria-hidden="true" />

      <header className="deck-share-card__header">
        <div className="deck-share-card__brand">
          <span aria-hidden="true">R</span>
          <div><strong>RiftLite</strong><small>Play. Track. Improve.</small></div>
        </div>
        <span className="deck-share-card__eyebrow"><Sparkles size={18} /> Your deck at a glance</span>
      </header>

      <div className="deck-share-card__layout">
        <section className="deck-share-card__copy">
          <p>I'm currently playing</p>
          <h2>{deck.legend}</h2>
          <div className="deck-share-card__deck-name"><span>{deck.sourceLabel}</span><strong>{deck.deckTitle}</strong></div>
          <div className="deck-share-card__stats">
            <div data-primary="true">
              <BarChart3 size={27} />
              <span><strong>{hasWinRate ? deck.winRateLabel : "—"}</strong><small>{hasWinRate ? "Win rate" : "Win rate pending"}</small></span>
            </div>
            <div>
              <Gamepad2 size={27} />
              <span><strong>{deck.totalGames}</strong><small>{gameLabel}</small></span>
            </div>
          </div>
          <p className="deck-share-card__record">Record <strong>{deck.record}</strong></p>
        </section>

        <DeckShareArtwork sources={deck.artSources} legend={deck.legend} />
      </div>

      <footer className="deck-share-card__footer">
        <span>Track all of this on</span>
        <strong>RiftLite.com</strong>
      </footer>
    </article>
  );
}

export function DeckShareCardDialog({ deck, onClose }: { deck: DeckShareCardViewModel; onClose: () => void }) {
  return (
    <ShareCardDialog
      eyebrow="Share your deck"
      title="Deck card preview"
      description="Your deck name, legend and aggregate record are included. The graphic is rendered and saved locally."
      label={`Deck-${deck.legend}-${deck.totalGames}-games`}
      caption={deckShareCaption(deck)}
      captureErrorMessage="The deck card could not be captured."
      onClose={onClose}
    >
      <DeckShareCard deck={deck} />
    </ShareCardDialog>
  );
}

function DeckShareArtwork({ sources, legend }: { sources: string[]; legend: string }) {
  const sourceKey = JSON.stringify(sources.map((source) => source.trim()).filter(Boolean));
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set());
  const availableSources = deckShareArtSources(sources, failedSources);
  const cardSources = availableSources.slice(0, 3);
  const backdropSource = availableSources[3] ?? availableSources[1] ?? availableSources[0] ?? "";
  const initials = legend.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "RL";

  useEffect(() => setFailedSources(new Set()), [sourceKey]);

  function markSourceFailed(source: string) {
    setFailedSources((current) => {
      if (current.has(source)) return current;
      const next = new Set(current);
      next.add(source);
      return next;
    });
  }

  return (
    <div className="deck-share-card__art" data-art-count={availableSources.length} aria-hidden="true">
      {backdropSource ? (
        <img
          className="deck-share-card__art-backdrop"
          src={backdropSource}
          alt=""
          draggable={false}
          onError={() => markSourceFailed(backdropSource)}
        />
      ) : null}
      <div className="deck-share-card__art-halo" />
      <div className="deck-share-card__art-orbit" />
      <div className="deck-share-card__art-fan">
        {cardSources.length ? cardSources.map((source, index) => (
          <figure
            key={source}
            className={`deck-share-card__art-card deck-share-card__art-card--${index === 0 ? "hero" : index === 1 ? "left" : "right"}`}
            data-art-slot={index === 0 ? "hero" : index === 1 ? "left" : "right"}
          >
            <img src={source} alt="" draggable={false} onError={() => markSourceFailed(source)} />
          </figure>
        )) : (
          <figure className="deck-share-card__art-card deck-share-card__art-card--hero deck-share-card__art-card--fallback" data-art-slot="fallback">
            <span>{initials}</span>
          </figure>
        )}
      </div>
      <div className="deck-share-card__art-label">
        <span>{availableSources.length ? "From your saved deck" : "Deck identity"}</span>
        <strong>{availableSources.length ? `${availableSources.length} artwork${availableSources.length === 1 ? "" : "s"} featured` : legend}</strong>
      </div>
    </div>
  );
}
