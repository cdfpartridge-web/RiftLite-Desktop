import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import cardLookupData from "../../resources/tcga_card_lookup.json";
import type {
  RiftLiteReplayCard,
  RiftLiteReplayFrame,
  RiftLiteReplayModel,
  RiftLiteReplayPlayer,
  RiftLiteReplaySide,
  RiftLiteReplayStage,
  RiftLiteReplayZone
} from "../shared/riftLiteReplayEngine";

type RiftLiteReplayViewerProps = {
  model: RiftLiteReplayModel;
};

const RIFT_CODEX_CARD_API = "https://api.riftcodex.com/cards/riftbound/";
const DEFAULT_RUNE_SLOTS = 12;
const riftCodexImageCache = new Map<string, string>();
const RiftCodexImageContext = React.createContext<Record<string, string>>({});
const CARD_CODE_BY_NAME = buildCardCodeByName(cardLookupData);

export function RiftLiteReplayViewer({ model }: RiftLiteReplayViewerProps) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [focusedCard, setFocusedCard] = useState<RiftLiteReplayCard | null>(null);
  const [trashSide, setTrashSide] = useState<"local" | "opponent" | null>(null);
  const [riftCodexImages, setRiftCodexImages] = useState<Record<string, string>>({});
  const frame = model.frames[Math.min(index, Math.max(0, model.frames.length - 1))] ?? model.frames[0];
  const progress = model.frames.length > 1 ? Math.round((index / (model.frames.length - 1)) * 100) : 0;
  const modelCodes = useMemo(() => collectModelCards(model), [model]);

  React.useEffect(() => {
    if (!playing || model.frames.length <= 1 || !frame) return;
    const timer = window.setTimeout(() => {
      setIndex((current) => {
        if (current >= model.frames.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, playbackFrameDelay(frame));
    return () => window.clearTimeout(timer);
  }, [frame, model.frames.length, playing]);

  React.useEffect(() => {
    setIndex(0);
    setPlaying(false);
    setFocusedCard(null);
    setTrashSide(null);
  }, [model.id]);

  React.useEffect(() => {
    let cancelled = false;
    const missing = modelCodes.filter((code) => !riftCodexImageCache.has(code));
    setRiftCodexImages(Object.fromEntries(modelCodes.map((code) => [code, riftCodexImageCache.get(code) || ""])));
    if (!missing.length) return () => {
      cancelled = true;
    };
    void (async () => {
      const next: Record<string, string> = {};
      for (const code of missing) {
        if (cancelled) return;
        try {
          const response = await fetch(`${RIFT_CODEX_CARD_API}${encodeURIComponent(code)}`);
          if (!response.ok) continue;
          const data = await response.json() as unknown;
          const image = imageFromRiftCodexResponse(data);
          if (image) {
            riftCodexImageCache.set(code, image);
            next[code] = image;
          }
        } catch {
          // Keep the bundled/fallback image URL when RiftCodex is offline or CORS blocks a lookup.
        }
      }
      if (!cancelled && Object.keys(next).length) {
        setRiftCodexImages((current) => ({ ...current, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelCodes]);

  if (!frame) {
    return (
      <div className="riftlite-replay-stage-empty">
        <h3>No replay frames were generated.</h3>
        <p>RiftLite found raw data, but it could not build a playable board state from it yet.</p>
      </div>
    );
  }

  const displayCard = focusedCard;

  return (
    <RiftCodexImageContext.Provider value={riftCodexImages}>
    <div className="riftlite-replay-viewer riftlite-replay-v2" data-stage={frame.stage}>
      <div className="riftlite-replay-v2-stage">
        <PlayerRail
          player={frame.local}
          onCardFocus={setFocusedCard}
          onTrashClick={() => setTrashSide("local")}
        />
        <main className="riftlite-replay-v2-main">
          {frame.stage === "board" ? (
            <BoardStage frame={frame} onCardFocus={setFocusedCard} />
          ) : (
            <IntroStage frame={frame} onCardFocus={setFocusedCard} />
          )}
        </main>
        <OpponentRail
          player={frame.opponent}
          onCardFocus={setFocusedCard}
          onTrashClick={() => setTrashSide("opponent")}
        />
        <ChainColumn cards={frame.chain} onCardFocus={setFocusedCard} />
        <Inspector model={model} frame={frame} card={displayCard} onEventClick={setIndex} />
      </div>

      {trashSide ? (
        <TrashDrawer
          player={trashSide === "local" ? frame.local : frame.opponent}
          onClose={() => setTrashSide(null)}
          onCardFocus={setFocusedCard}
        />
      ) : null}

      <ReplayTransport
        frame={frame}
        frameCount={model.frames.length}
        index={index}
        onChange={setIndex}
        playing={playing}
        progress={progress}
        setPlaying={setPlaying}
      />
    </div>
    </RiftCodexImageContext.Provider>
  );
}

function playbackFrameDelay(frame: RiftLiteReplayFrame): number {
  switch (frame.stage) {
    case "matchup":
      return 2600;
    case "battlefields":
      return 3200;
    case "initiative":
      return 3000;
    case "mulligan":
      return 3600;
    case "openingHands":
      return 2700;
    case "board":
    default:
      return 640;
  }
}

function BoardStage({ frame, onCardFocus }: { frame: RiftLiteReplayFrame; onCardFocus: (card: RiftLiteReplayCard) => void }) {
  const battlefields = buildBattlefieldContests(frame);
  return (
    <div className="rr-board-stage">
      <section className="rr-opponent-hand-row">
        <RuneStrip player={frame.opponent} onCardFocus={onCardFocus} compact />
        <HiddenHand count={zone(frame.opponent, "hand").cards.length || 5} />
        <ScorePip player={frame.opponent} />
      </section>

      <ZonePanel
        className="rr-opponent-base"
        title="Base"
        zone={zone(frame.opponent, "base")}
        onCardFocus={onCardFocus}
      />

      <div className="rr-battlefield-grid">
        <BattlefieldContestPanel
          battlefieldCard={battlefields.left.battlefieldCard}
          localCards={battlefields.left.localCards}
          onCardFocus={onCardFocus}
          opponentCards={battlefields.left.opponentCards}
          title={battlefields.left.title}
        />
        <BattlefieldContestPanel
          battlefieldCard={battlefields.right.battlefieldCard}
          localCards={battlefields.right.localCards}
          onCardFocus={onCardFocus}
          opponentCards={battlefields.right.opponentCards}
          title={battlefields.right.title}
        />
      </div>

      <ZonePanel
        className="rr-local-base"
        title="Base"
        zone={zone(frame.local, "base")}
        onCardFocus={onCardFocus}
      />

      <section className="rr-local-bottom">
        <div className="rr-local-runes-row">
          <RuneStrip player={frame.local} onCardFocus={onCardFocus} />
          <ScorePip player={frame.local} />
        </div>
        <CardFan cards={zone(frame.local, "hand").cards.slice(0, 12)} onCardFocus={onCardFocus} />
      </section>
    </div>
  );
}

function buildBattlefieldContests(frame: RiftLiteReplayFrame): {
  left: BattlefieldContest;
  right: BattlefieldContest;
} {
  const localSelected = selectedBattlefield(frame.local);
  const opponentSelected = selectedBattlefield(frame.opponent);
  const localCards = battlefieldUnitCards(frame.local);
  const opponentCards = battlefieldUnitCards(frame.opponent);
  const byZone = (cards: RiftLiteReplayCard[], battlefieldZone: string) => cards.filter((card) => card.battlefieldZone === battlefieldZone);
  const withoutKnownZone = (cards: RiftLiteReplayCard[]) => cards.filter((card) => !card.battlefieldZone);

  return {
    left: {
      title: localSelected?.name || "Battlefield",
      battlefieldCard: localSelected,
      opponentCards: byZone(opponentCards, "battlefieldb"),
      localCards: byZone(localCards, "battlefieldb").concat(withoutKnownZone(localCards))
    },
    right: {
      title: opponentSelected?.name || "Opponent's battlefield",
      battlefieldCard: opponentSelected,
      opponentCards: byZone(opponentCards, "battlefielda").concat(withoutKnownZone(opponentCards)),
      localCards: byZone(localCards, "battlefielda")
    }
  };
}

interface BattlefieldContest {
  battlefieldCard?: RiftLiteReplayCard;
  localCards: RiftLiteReplayCard[];
  opponentCards: RiftLiteReplayCard[];
  title: string;
}

function IntroStage({ frame, onCardFocus }: { frame: RiftLiteReplayFrame; onCardFocus: (card: RiftLiteReplayCard) => void }) {
  return (
    <div className="rr-intro-stage" data-stage={frame.stage}>
      <div className="rr-intro-title">
        <span>{stageEyebrow(frame.stage)}</span>
        <h2>{frame.headline || frame.label}</h2>
        {frame.subline ? <p>{frame.subline}</p> : null}
      </div>
      {frame.stage === "matchup" ? <MatchupIntro frame={frame} onCardFocus={onCardFocus} /> : null}
      {frame.stage === "battlefields" ? <BattlefieldsIntro frame={frame} onCardFocus={onCardFocus} /> : null}
      {frame.stage === "initiative" ? <InitiativeIntro frame={frame} /> : null}
      {frame.stage === "mulligan" ? <MulliganIntro frame={frame} onCardFocus={onCardFocus} /> : null}
      {frame.stage === "openingHands" ? <OpeningHandsIntro frame={frame} onCardFocus={onCardFocus} /> : null}
    </div>
  );
}

function MatchupIntro({ frame, onCardFocus }: { frame: RiftLiteReplayFrame; onCardFocus: (card: RiftLiteReplayCard) => void }) {
  return (
    <div className="rr-matchup-intro">
      <IntroPlayer player={frame.opponent} onCardFocus={onCardFocus} />
      <strong>VS</strong>
      <IntroPlayer player={frame.local} onCardFocus={onCardFocus} />
    </div>
  );
}

function BattlefieldsIntro({ frame, onCardFocus }: { frame: RiftLiteReplayFrame; onCardFocus: (card: RiftLiteReplayCard) => void }) {
  const entries = [
    { card: selectedBattlefield(frame.opponent), label: "Opponent battlefield", player: frame.opponent, side: "opponent" },
    { card: selectedBattlefield(frame.local), label: "Your battlefield", player: frame.local, side: "local" }
  ].filter((entry) => Boolean(entry.card)) as Array<{
    card: RiftLiteReplayCard;
    label: string;
    player: RiftLiteReplayPlayer;
    side: "local" | "opponent";
  }>;
  return (
    <div className="rr-battlefield-intro">
      {entries.length ? entries.map((entry) => (
        <BattlefieldRevealCard
          card={entry.card}
          key={`${entry.side}-${entry.card.id}`}
          label={entry.label}
          onCardFocus={onCardFocus}
          player={entry.player}
          side={entry.side}
        />
      )) : (
        <div className="rr-empty-zone">Battlefields will appear once Atlas exposes them in the raw replay.</div>
      )}
    </div>
  );
}

function BattlefieldRevealCard({
  card,
  label,
  onCardFocus,
  player,
  side
}: {
  card: RiftLiteReplayCard;
  label: string;
  onCardFocus: (card: RiftLiteReplayCard) => void;
  player: RiftLiteReplayPlayer;
  side: "local" | "opponent";
}) {
  const imageUrl = useResolvedCardImage(card);
  return (
    <button
      type="button"
      className="rr-battlefield-reveal"
      data-side={side}
      onClick={() => onCardFocus(card)}
      onMouseEnter={() => onCardFocus(card)}
      onFocus={() => onCardFocus(card)}
      title={card.name}
    >
      <span>{label}</span>
      <div className="rr-battlefield-card-frame">
        {imageUrl ? <img src={imageUrl} alt="" /> : <em>{fallbackInitials(card.name)}</em>}
      </div>
      <strong>{card.name}</strong>
      <small>{player.name}</small>
    </button>
  );
}

function InitiativeIntro({ frame }: { frame: RiftLiteReplayFrame }) {
  const initiative = frame.initiative;
  const firstPlayerName = initiative?.firstPlayerName || "";
  const opponentRoll = initiative?.opponentRoll ?? rollFromFrameEvents(frame, frame.opponent.name);
  const localRoll = initiative?.localRoll ?? rollFromFrameEvents(frame, frame.local.name);
  const firstPlayerLabel = firstPlayerName || initiative?.choosingPlayerName || "";
  return (
    <div className="rr-initiative-intro">
      <IntroBattlefieldAnchor
        card={selectedBattlefield(frame.opponent)}
        label={frame.opponent.name}
        side="opponent"
      />
      <div className="rr-initiative-core">
        <RollCard
          fallbackLabel={firstPlayerLabel ? firstChoiceLabel(firstPlayerLabel, frame.opponent.name) : undefined}
          player={frame.opponent}
          roll={opponentRoll}
          winner={namesMatch(firstPlayerLabel, frame.opponent.name)}
        />
        <strong>ROLL</strong>
        <RollCard
          fallbackLabel={firstPlayerLabel ? firstChoiceLabel(firstPlayerLabel, frame.local.name) : undefined}
          player={frame.local}
          roll={localRoll}
          winner={namesMatch(firstPlayerLabel, frame.local.name)}
        />
        <p>{firstPlayerLabel ? `${firstPlayerLabel} will go first` : "Waiting for first-player decision in the replay log."}</p>
      </div>
      <IntroBattlefieldAnchor
        card={selectedBattlefield(frame.local)}
        label={frame.local.name}
        side="local"
      />
    </div>
  );
}

function IntroBattlefieldAnchor({ card, label, side }: { card?: RiftLiteReplayCard; label: string; side: "local" | "opponent" }) {
  const imageUrl = useResolvedCardImage(card);
  return (
    <div className="rr-initiative-battlefield" data-side={side}>
      {imageUrl && card ? <img src={imageUrl} alt="" /> : <span>{card?.name || "Battlefield"}</span>}
      <small>{label}</small>
    </div>
  );
}

function MulliganIntro({ frame, onCardFocus }: { frame: RiftLiteReplayFrame; onCardFocus: (card: RiftLiteReplayCard) => void }) {
  const originalHand = frame.mulligan?.localOriginalHand?.length ? frame.mulligan.localOriginalHand : zone(frame.local, "hand").cards.slice(0, 4);
  const finalHand = frame.mulligan?.localFinalHand?.length ? frame.mulligan.localFinalHand : originalHand;
  const removed = frame.mulligan?.localMulliganedCards ?? [];
  const added = frame.mulligan?.localAddedCards ?? [];
  const opponentOriginal = frame.mulligan?.opponentOriginalHandCount || frame.mulligan?.opponentCardsSeen || 4;
  const opponentFinal = frame.mulligan?.opponentFinalHandCount || opponentOriginal;
  return (
    <div className="rr-mulligan-intro">
      <div className="rr-mulligan-player" data-side="opponent">
        <small>{frame.opponent.name}</small>
        <HiddenHand count={opponentOriginal} large />
        <div className="rr-mulligan-arrow">Opponent hand hidden</div>
        <HiddenHand count={opponentFinal} large />
      </div>
      <div className="rr-mulligan-player" data-side="local">
        <small>{frame.local.name}</small>
        <MulliganCardStrip cards={originalHand} changedCards={removed} mode="removed" onCardFocus={onCardFocus} />
        <div className="rr-mulligan-arrow">
          {removed.length || added.length ? `${removed.length} out, ${added.length} in` : "Kept opening hand"}
        </div>
        <MulliganCardStrip cards={finalHand} changedCards={added} mode="added" onCardFocus={onCardFocus} />
      </div>
    </div>
  );
}

function MulliganCardStrip({
  cards,
  changedCards,
  mode,
  onCardFocus
}: {
  cards: RiftLiteReplayCard[];
  changedCards: RiftLiteReplayCard[];
  mode: "added" | "removed";
  onCardFocus: (card: RiftLiteReplayCard) => void;
}) {
  const changed = new Set(changedCards.map(cardVisualIdentity));
  return (
    <div className="rr-mulligan-card-strip">
      {cards.length ? cards.slice(0, 6).map((card) => (
        <span key={`${mode}-${card.id}`} data-change={changed.has(cardVisualIdentity(card)) ? mode : undefined}>
          <CardView card={card} onCardFocus={onCardFocus} />
        </span>
      )) : <div className="rr-empty-zone">Opening hand pending</div>}
    </div>
  );
}

function OpeningHandsIntro({ frame, onCardFocus }: { frame: RiftLiteReplayFrame; onCardFocus: (card: RiftLiteReplayCard) => void }) {
  const localHand = frame.mulligan?.localFinalHand?.length ? frame.mulligan.localFinalHand : zone(frame.local, "hand").cards.slice(0, 8);
  const opponentHandCount = frame.mulligan?.opponentFinalHandCount || frame.mulligan?.opponentCardsSeen || zone(frame.opponent, "hand").cards.length || 4;
  return (
    <div className="rr-opening-intro">
      <div>
        <small>{frame.opponent.name}</small>
        <HiddenHand count={opponentHandCount} large />
        <StatusBadge active={frame.mulligan?.opponentKept}>Opponent kept</StatusBadge>
      </div>
      <div>
        <small>{frame.local.name}</small>
        <CardFan cards={localHand} onCardFocus={onCardFocus} />
        <StatusBadge active={frame.mulligan?.localKept}>Hand ready</StatusBadge>
      </div>
    </div>
  );
}

function IntroPlayer({ player, onCardFocus }: { player: RiftLiteReplayPlayer; onCardFocus: (card: RiftLiteReplayCard) => void }) {
  return (
    <div className="rr-intro-player">
      <div className="rr-intro-card-pair">
        {player.legend ? <CardView card={player.legend} onCardFocus={onCardFocus} hero /> : null}
        {player.champion ? <CardView card={player.champion} onCardFocus={onCardFocus} /> : null}
      </div>
      <strong>{player.name}</strong>
      <small>{player.legend?.name || "Legend pending"}</small>
    </div>
  );
}

function PlayerRail({
  onCardFocus,
  onTrashClick,
  player
}: {
  onCardFocus: (card: RiftLiteReplayCard) => void;
  onTrashClick: () => void;
  player: RiftLiteReplayPlayer;
}) {
  return (
    <aside className="rr-player-rail rr-player-rail-local">
      <div className="rr-rail-spacer" />
      <RailPlayer player={player} onCardFocus={onCardFocus} onTrashClick={onTrashClick} local />
    </aside>
  );
}

function OpponentRail({
  onCardFocus,
  onTrashClick,
  player
}: {
  onCardFocus: (card: RiftLiteReplayCard) => void;
  onTrashClick: () => void;
  player: RiftLiteReplayPlayer;
}) {
  return (
    <aside className="rr-opponent-rail">
      <RailPlayer player={player} onCardFocus={onCardFocus} onTrashClick={onTrashClick} opponent />
      <div className="rr-rail-spacer" />
    </aside>
  );
}

function RailPlayer({
  local = false,
  onCardFocus,
  onTrashClick,
  opponent = false,
  player
}: {
  local?: boolean;
  onCardFocus: (card: RiftLiteReplayCard) => void;
  onTrashClick: () => void;
  opponent?: boolean;
  player: RiftLiteReplayPlayer;
}) {
  const trash = zone(player, "trash").cards;
  const topTrash = trash[trash.length - 1];
  const identity = (
    <div className="rr-identity-stack">
      <span>{player.name}</span>
      {player.legend ? <CardView card={player.legend} compact onCardFocus={onCardFocus} /> : null}
      {player.champion ? <CardView card={player.champion} compact onCardFocus={onCardFocus} /> : null}
    </div>
  );
  const deck = <DeckCounter count={player.deckCount ?? zone(player, "deck").count ?? zone(player, "deck").cards.length} />;
  const trashButton = (
    <button type="button" className="rr-trash-slot" onClick={onTrashClick} title={`${player.name} trash`}>
      {topTrash ? <CardView card={topTrash} compact onCardFocus={onCardFocus} /> : <span>0</span>}
    </button>
  );
  return (
    <div className="rr-rail-player" data-local={local} data-opponent={opponent}>
      {opponent ? identity : deck}
      {trashButton}
      {opponent ? deck : identity}
    </div>
  );
}

function ZonePanel({
  className,
  landscape = false,
  onCardFocus,
  side,
  title,
  zone
}: {
  className?: string;
  landscape?: boolean;
  onCardFocus: (card: RiftLiteReplayCard) => void;
  side?: RiftLiteReplaySide;
  title: string;
  zone: RiftLiteReplayZone;
}) {
  const cards = zone.cards.slice(-16);
  const battlefieldCard = landscape
    ? cards.find((card) => card.id.startsWith("selected-battlefield-"))
    : undefined;
  const fieldCards = battlefieldCard
    ? cards.filter((card) => cardVisualIdentity(card) !== cardVisualIdentity(battlefieldCard))
    : cards;
  const battlefieldLayout = landscape ? (
    <div className="rr-battlefield-zone-layout" data-side={side}>
      <div className="rr-battlefield-units" data-lane="opponent">
        {side === "opponent" ? fieldCards.map((card) => <CardView card={card} key={card.id} onCardFocus={onCardFocus} />) : null}
      </div>
      <div className="rr-battlefield-card-slot">
        {battlefieldCard ? <CardView card={battlefieldCard} key={battlefieldCard.id} onCardFocus={onCardFocus} landscape /> : null}
      </div>
      <div className="rr-battlefield-units" data-lane="local">
        {side === "local" ? fieldCards.map((card) => <CardView card={card} key={card.id} onCardFocus={onCardFocus} />) : null}
      </div>
    </div>
  ) : null;

  return (
    <section className={`rr-zone ${className || ""}`} data-landscape={landscape} data-side={side}>
      <span>{title}</span>
      <div>
        {battlefieldLayout ?? cards.map((card) => (
          <CardView card={card} key={card.id} onCardFocus={onCardFocus} />
        ))}
      </div>
    </section>
  );
}

function BattlefieldContestPanel({
  battlefieldCard,
  localCards,
  onCardFocus,
  opponentCards,
  title
}: {
  battlefieldCard?: RiftLiteReplayCard;
  localCards: RiftLiteReplayCard[];
  onCardFocus: (card: RiftLiteReplayCard) => void;
  opponentCards: RiftLiteReplayCard[];
  title: string;
}) {
  return (
    <section className="rr-zone rr-battlefield-contest" data-landscape="true">
      <span>{title}</span>
      <div className="rr-battlefield-zone-layout">
        <div className="rr-battlefield-units" data-lane="opponent">
          {opponentCards.slice(-8).map((card) => <CardView card={card} key={card.id} onCardFocus={onCardFocus} />)}
        </div>
        <div className="rr-battlefield-card-slot">
          {battlefieldCard ? <CardView card={battlefieldCard} key={battlefieldCard.id} onCardFocus={onCardFocus} landscape /> : null}
        </div>
        <div className="rr-battlefield-units" data-lane="local">
          {localCards.slice(-8).map((card) => <CardView card={card} key={card.id} onCardFocus={onCardFocus} />)}
        </div>
      </div>
    </section>
  );
}

function RuneStrip({
  compact = false,
  onCardFocus,
  player
}: {
  compact?: boolean;
  onCardFocus: (card: RiftLiteReplayCard) => void;
  player: RiftLiteReplayPlayer;
}) {
  const runes = zone(player, "runes").cards;
  const visibleCount = player.runeCount ?? zone(player, "runes").count ?? runes.length;
  const deckSlots = zone(player, "runeDeck").count ?? DEFAULT_RUNE_SLOTS;
  const slotCount = compact
    ? Math.min(DEFAULT_RUNE_SLOTS, Math.max(visibleCount || 0, runes.length, Math.min(deckSlots, DEFAULT_RUNE_SLOTS)))
    : Math.min(DEFAULT_RUNE_SLOTS, Math.max(visibleCount || 0, runes.length, Math.min(deckSlots, DEFAULT_RUNE_SLOTS)));
  const visibleRunes = runes.slice(0, slotCount);
  const emptySlots = Math.max(0, slotCount - visibleRunes.length);
  return (
    <div className="rr-runes" data-compact={compact}>
      <span>RUNES</span>
      {visibleRunes.map((card) => <CardView card={card} mini key={card.id} onCardFocus={onCardFocus} />)}
      {Array.from({ length: emptySlots }).map((_, index) => <i key={index} />)}
    </div>
  );
}

function ChainColumn({ cards, onCardFocus }: { cards: RiftLiteReplayCard[]; onCardFocus: (card: RiftLiteReplayCard) => void }) {
  return (
    <aside className="rr-chain">
      <span>CHAIN</span>
      {cards.slice(-8).reverse().map((card) => <CardView card={card} compact key={card.id} onCardFocus={onCardFocus} />)}
    </aside>
  );
}

function Inspector({
  card,
  frame,
  model,
  onEventClick
}: {
  card?: RiftLiteReplayCard | null;
  frame: RiftLiteReplayFrame;
  model: RiftLiteReplayModel;
  onEventClick: (index: number) => void;
}) {
  const events = useMemo(
    () => model.events.filter((event) => event.frameIndex <= frame.index && isVisibleReplayEvent(event.label, event.detail)).slice(-12),
    [frame.index, model.events]
  );
  const imageUrl = useResolvedCardImage(card);
  return (
    <aside className="rr-inspector">
      <header>
        <strong>RiftLite Replay</strong>
        <small>{model.title}</small>
      </header>
      <div className="rr-focused-card">
        {imageUrl && card && !card.faceDown ? <img src={imageUrl} alt="" /> : <span>{card?.name || "Card focus"}</span>}
      </div>
      <div className="rr-event-log">
        <span>CHAT</span>
        {events.map((event) => (
          <button type="button" key={event.id} onClick={() => onEventClick(event.frameIndex)}>
            <strong>[{event.timeLabel}]</strong> {event.detail || event.label}
          </button>
        ))}
      </div>
    </aside>
  );
}

function TrashDrawer({
  onCardFocus,
  onClose,
  player
}: {
  onCardFocus: (card: RiftLiteReplayCard) => void;
  onClose: () => void;
  player: RiftLiteReplayPlayer;
}) {
  const cards = zone(player, "trash").cards.slice().reverse();
  return (
    <div className="riftlite-replay-trash-drawer rr-trash-drawer">
      <div>
        <button type="button" className="secondary" onClick={onClose}>Close</button>
        <strong>{player.name} trash</strong>
        <small>{cards.length} cards, newest first</small>
      </div>
      <div className="riftlite-replay-trash-grid">
        {cards.map((card) => <CardView card={card} key={card.id} onCardFocus={onCardFocus} />)}
      </div>
    </div>
  );
}

function ReplayTransport({
  frame,
  frameCount,
  index,
  onChange,
  playing,
  progress,
  setPlaying
}: {
  frame: RiftLiteReplayFrame;
  frameCount: number;
  index: number;
  onChange: (index: number) => void;
  playing: boolean;
  progress: number;
  setPlaying: (playing: boolean) => void;
}) {
  return (
    <div className="rr-transport">
      <button type="button" onClick={() => onChange(0)}><SkipBack size={15} /></button>
      <button type="button" onClick={() => onChange(Math.max(0, index - 1))}><ChevronLeft size={15} /> Rewind</button>
      <button type="button" className="primary" onClick={() => setPlaying(!playing)}>
        {playing ? <Pause size={15} /> : <Play size={15} />} {playing ? "Pause" : "Play"}
      </button>
      <button type="button" onClick={() => onChange(Math.min(frameCount - 1, index + 1))}>Fast forward <ChevronRight size={15} /></button>
      <button type="button" onClick={() => onChange(frameCount - 1)}><SkipForward size={15} /></button>
      <div className="rr-slider">
        <span style={{ width: `${progress}%` }} />
      </div>
      <small>{index + 1}/{Math.max(frameCount, 1)} - {frame.turn ? `Turn ${frame.turn}` : frame.label}</small>
    </div>
  );
}

function CardView({
  card,
  compact = false,
  hero = false,
  landscape = false,
  mini = false,
  onCardFocus
}: {
  card: RiftLiteReplayCard;
  compact?: boolean;
  hero?: boolean;
  landscape?: boolean;
  mini?: boolean;
  onCardFocus: (card: RiftLiteReplayCard) => void;
}) {
  const imageUrl = useResolvedCardImage(card);
  return (
    <button
      type="button"
      className="rr-card"
      data-compact={compact}
      data-hero={hero}
      data-landscape={landscape}
      data-mini={mini}
      data-face-down={card.faceDown}
      data-exhausted={card.exhausted}
      onClick={() => onCardFocus(card)}
      onFocus={() => onCardFocus(card)}
      onMouseEnter={() => onCardFocus(card)}
      title={card.name}
    >
      {imageUrl && !card.faceDown ? <img src={imageUrl} alt="" /> : <span>{fallbackInitials(card.name)}</span>}
    </button>
  );
}

function CardFan({ cards, onCardFocus }: { cards: RiftLiteReplayCard[]; onCardFocus: (card: RiftLiteReplayCard) => void }) {
  return (
    <div className="rr-card-fan">
      {cards.length ? cards.map((card) => <CardView card={card} key={card.id} onCardFocus={onCardFocus} />) : <div className="rr-empty-zone">Hand hidden</div>}
    </div>
  );
}

function HiddenHand({ count, large = false }: { count: number; large?: boolean }) {
  return (
    <div className="rr-hidden-hand" data-large={large}>
      {Array.from({ length: Math.min(Math.max(count, 0), 10) }).map((_, index) => <i key={index} />)}
    </div>
  );
}

function DeckCounter({ count }: { count?: number }) {
  return (
    <div className="rr-deck-counter">
      <strong>{typeof count === "number" ? count : "?"}</strong>
    </div>
  );
}

function ScorePip({ player }: { player: RiftLiteReplayPlayer }) {
  return (
    <div className="rr-score-pip">
      <strong>{player.score ?? 0}</strong>
      <small>/{player.maxScore ?? 8}</small>
    </div>
  );
}

function RollCard({
  fallbackLabel,
  player,
  roll,
  winner = false
}: {
  fallbackLabel?: string;
  player: RiftLiteReplayPlayer;
  roll?: number;
  winner?: boolean;
}) {
  const hasRoll = typeof roll === "number";
  const hasKnownChoice = !hasRoll && Boolean(fallbackLabel);
  return (
    <div className="rr-roll-card" data-winner={winner} data-has-roll={hasRoll} data-choice-only={hasKnownChoice}>
      <strong className="rr-d20"><span>{hasRoll ? roll : fallbackLabel || "..."}</span></strong>
      <span>{player.name}</span>
    </div>
  );
}

function StatusBadge({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return <span className="rr-status-badge" data-active={Boolean(active)}>{children}</span>;
}

function stageEyebrow(stage: RiftLiteReplayStage): string {
  if (stage === "matchup") return "THE MATCHUP";
  if (stage === "battlefields") return "BATTLEFIELDS";
  if (stage === "initiative") return "INITIATIVE";
  if (stage === "mulligan") return "MULLIGAN";
  if (stage === "openingHands") return "OPENING HANDS";
  return "BOARD";
}

function fallbackInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "RL";
}

function firstChoiceLabel(firstPlayerName: string, playerName: string): string {
  return namesMatch(firstPlayerName, playerName) ? "1st" : "2nd";
}

function rollFromFrameEvents(frame: RiftLiteReplayFrame, playerName: string): number | undefined {
  const normalizedPlayer = normalizeText(playerName);
  for (const event of frame.events.slice().reverse()) {
    const text = `${event.playerName || ""} ${event.detail || ""} ${event.label || ""}`;
    for (const candidate of rollCandidates(text)) {
      if (namesMatch(candidate.name, playerName) || normalizeText(text).includes(normalizedPlayer)) {
        return candidate.value;
      }
    }
  }
  return undefined;
}

function rollCandidates(text: string): Array<{ name: string; value: number }> {
  const results: Array<{ name: string; value: number }> = [];
  const patterns = [
    /([A-Za-z0-9_][A-Za-z0-9_\-\s.'[\]]{0,44}?)\s+roll(?:ed|s)?(?:\s+a)?(?:\s+d20)?[^\d\n]{0,18}(\d{1,2})/gi,
    /([A-Za-z0-9_][A-Za-z0-9_\-\s.'[\]]{0,44}?)\s+rolled\s+(\d{1,2})/gi
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const value = Number(match[2]);
      if (Number.isFinite(value) && value >= 1 && value <= 20) {
        results.push({ name: match[1].replace(/\b(?:chat|initiative|roll)\b/gi, "").trim(), value });
      }
    }
  }
  return results;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function namesMatch(left: string | undefined, right: string | undefined): boolean {
  const a = normalizeText(left || "");
  const b = normalizeText(right || "");
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function zone(player: RiftLiteReplayPlayer, zoneId: string): RiftLiteReplayZone {
  return player.zones[zoneId] ?? { id: zoneId, label: zoneId, cards: [] };
}

function battlefieldUnitCards(player: RiftLiteReplayPlayer): RiftLiteReplayCard[] {
  const selectedKeys = new Set([player.selectedBattlefield?.id, player.selectedBattlefield?.key, player.selectedBattlefield?.code, player.selectedBattlefield?.name].filter(Boolean));
  return zone(player, "battlefield").cards.filter((card) => {
    if (card.id.startsWith("selected-battlefield-")) return false;
    return ![card.id, card.key, card.code, card.name].some((value) => value && selectedKeys.has(value));
  });
}

function selectedBattlefield(player: RiftLiteReplayPlayer): RiftLiteReplayCard | undefined {
  return player.selectedBattlefield ?? zone(player, "battlefield").cards.find((card) => card.id.startsWith("selected-battlefield-"));
}

function cardVisualIdentity(card: RiftLiteReplayCard): string {
  return card.id || card.key || normalizeRiftCodexCode(card.code || "") || card.name;
}

function useResolvedCardImage(card?: RiftLiteReplayCard | null): string {
  const images = React.useContext(RiftCodexImageContext);
  const code = resolveCardCode(card);
  return (code && images[code]) || card?.imageUrl || "";
}

function collectModelCards(model: RiftLiteReplayModel): string[] {
  const codes = new Set<string>();
  const add = (card?: RiftLiteReplayCard) => {
    const code = resolveCardCode(card);
    if (code) codes.add(code);
  };
  for (const frame of model.frames) {
    add(frame.focusedCard);
    for (const player of [frame.local, frame.opponent]) {
      add(player.legend);
      add(player.champion);
      add(player.selectedBattlefield);
      for (const zoneValue of Object.values(player.zones)) {
        for (const card of zoneValue.cards) add(card);
      }
    }
    for (const card of frame.chain) add(card);
  }
  return Array.from(codes).slice(0, 180);
}

function resolveCardCode(card?: RiftLiteReplayCard | null): string {
  const explicit = normalizeRiftCodexCode(card?.code || "");
  if (explicit) return explicit;
  return CARD_CODE_BY_NAME.get(normalizeCardLookupName(card?.name || "")) || "";
}

function normalizeRiftCodexCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return "";
  const basic = /^([A-Z]{3})-(\d{3}[A-Z]?)/.exec(normalized);
  if (basic?.[1] && basic?.[2]) return `${basic[1]}-${basic[2]}`;
  return normalized;
}

function imageFromRiftCodexResponse(data: unknown): string {
  const record = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  const value = Array.isArray(data)
    ? data[0]
    : Array.isArray(record?.value)
      ? record.value[0]
      : record?.value ?? record;
  const card = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const media = card?.media && typeof card.media === "object" ? card.media as Record<string, unknown> : null;
  return typeof media?.image_url === "string" ? media.image_url : typeof card?.image_url === "string" ? card.image_url : "";
}

function buildCardCodeByName(data: unknown): Map<string, string> {
  const result = new Map<string, string>();
  const root = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const codeMap = root.codeMap && typeof root.codeMap === "object" ? root.codeMap as Record<string, unknown> : {};
  for (const [code, name] of Object.entries(codeMap)) {
    if (typeof name !== "string") continue;
    const normalizedCode = normalizeRiftCodexCode(code);
    const normalizedName = normalizeCardLookupName(name);
    if (normalizedCode && normalizedName && !result.has(normalizedName)) {
      result.set(normalizedName, normalizedCode);
    }
    const baseTokenName = normalizeCardLookupName(name.replace(/\([^)]*\)/g, ""));
    if (normalizedCode && baseTokenName && !result.has(baseTokenName)) {
      result.set(baseTokenName, normalizedCode);
    }
  }
  return result;
}

function isVisibleReplayEvent(label = "", detail = ""): boolean {
  const text = `${label} ${detail}`.toLowerCase();
  if (!text.trim()) return false;
  return ![
    "room state updated",
    "room update",
    "board snapshot",
    "board state updated",
    "player update",
    "game update",
    "zone update",
    "phase in game",
    "phase in_game"
  ].some((noise) => text.includes(noise));
}

function normalizeCardLookupName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
