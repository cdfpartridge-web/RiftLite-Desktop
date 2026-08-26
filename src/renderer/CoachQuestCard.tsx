import { useEffect, useId, useState } from "react";
import "./styles/coachQuest.css";

/** The lesson family controls the card's accent colour and its short label. */
export type CoachQuestCategory =
  | "mulligan"
  | "sequencing"
  | "battlefield"
  | "sideboard"
  | "resource"
  | "card-usage"
  | "matchup";

export type CoachQuestStatus = "pending" | "active" | "awaiting-review" | "complete";

export type CoachQuestGameState = "success" | "missed" | "unsure" | "active" | "pending";

export interface CoachQuestArtwork {
  /** Artwork URL. Local file URLs and data URLs are also supported by Electron. */
  url?: string;
  /** Human-readable card, Legend, or battlefield name. */
  name: string;
}

export interface CoachQuestMetricComparator {
  label: string;
  numerator: number;
  denominator: number;
}

export interface CoachQuestMetric {
  /** Short outcome label, for example "Turn-two play found". */
  label: string;
  numerator: number;
  denominator: number;
  /** Explicit tone avoids guessing whether a high or low percentage is desirable. */
  tone?: "positive" | "negative" | "neutral";
  /** Plain-language data receipt shown beneath the visual. */
  receipt?: string;
  /** Optional benchmark rendered alongside the player's result. */
  comparator?: CoachQuestMetricComparator;
}

export interface CoachQuestEvidenceAction {
  id: string;
  /** Button title, for example "Watch the missed turn-two window". */
  label: string;
  /** Supporting receipt such as "Game 2 · 03:14". */
  detail?: string;
  tone?: "proof" | "positive" | "warning";
}

export interface CoachQuestChallengeGame {
  state: CoachQuestGameState;
  /** Accessible label and optional visible tooltip for this game. */
  label?: string;
}

/**
 * A display-ready coaching lesson. Analysis and persistence stay outside this
 * component so the same model can be rendered in-app or as a share image.
 */
export interface CoachQuestViewModel {
  id: string;
  category: CoachQuestCategory;
  /** Review questions must be understood before they can become a test. */
  kind?: "challenge" | "review";
  title: string;
  /** Short factual observation kept separate from the learner-facing title. */
  observation?: string;
  status: CoachQuestStatus;
  when: string;
  rule: string;
  why: string;
  metric: CoachQuestMetric;
  art?: {
    card?: CoachQuestArtwork;
    legend?: CoachQuestArtwork;
    battlefield?: CoachQuestArtwork;
  };
  evidenceActions?: readonly CoachQuestEvidenceAction[];
  challenge: {
    /** Exactly three entries keep every quest focused on a three-game test. */
    games: readonly [CoachQuestChallengeGame, CoachQuestChallengeGame, CoachQuestChallengeGame];
    title?: string;
    label?: string;
  };
  /** Optional social-card footer, for example "Rengar vs Kennen". */
  shareCaption?: string;
}

export interface CoachQuestCardProps {
  quest: CoachQuestViewModel;
  /** `share-preview` creates a clean 16:9 capture surface without controls. */
  mode?: "interactive" | "share-preview";
  onStart?: () => void;
  onReview?: (evidenceId?: string) => void;
  onLab?: () => void;
  onContext?: () => void;
  onShare?: () => void;
}

const CATEGORY_LABELS: Record<CoachQuestCategory, string> = {
  mulligan: "Mulligan",
  sequencing: "Sequencing",
  battlefield: "Battlefield",
  sideboard: "Sideboard",
  resource: "Resource use",
  "card-usage": "Card usage",
  matchup: "Matchup"
};

const STATUS_LABELS: Record<CoachQuestStatus, string> = {
  pending: "Ready to start",
  active: "Challenge active",
  "awaiting-review": "Check-in ready",
  complete: "Quest complete"
};

const GAME_STATE_LABELS: Record<CoachQuestGameState, string> = {
  success: "Rule followed",
  missed: "Rule missed",
  unsure: "Needs another look",
  active: "Current game",
  pending: "Not played yet"
};

export function CoachQuestCard({
  quest,
  mode = "interactive",
  onStart,
  onReview,
  onLab,
  onContext,
  onShare
}: CoachQuestCardProps) {
  const rawId = useId().replace(/:/g, "");
  const titleId = `coach-quest-title-${rawId}`;
  const chartTitleId = `coach-quest-chart-title-${rawId}`;
  const chartDescriptionId = `coach-quest-chart-description-${rawId}`;
  const metricRate = percentage(quest.metric.numerator, quest.metric.denominator);
  const comparatorRate = quest.metric.comparator
    ? percentage(quest.metric.comparator.numerator, quest.metric.comparator.denominator)
    : undefined;
  const delta = comparatorRate == null ? undefined : metricRate - comparatorRate;
  const isComplement = Boolean(quest.metric.comparator
    && quest.metric.denominator === quest.metric.comparator.denominator
    && quest.metric.numerator + quest.metric.comparator.numerator === quest.metric.denominator);
  const isSharePreview = mode === "share-preview";
  const isReview = quest.kind === "review";
  const evidenceActions = quest.evidenceActions?.slice(0, 3) ?? [];
  const primaryReview = isReview || quest.status === "awaiting-review" || quest.status === "complete";
  const firstEvidenceId = evidenceActions[0]?.id;
  const primaryLabel = isReview
    ? evidenceActions.length ? `Review ${evidenceActions.length} ${evidenceActions.length === 1 ? "moment" : "moments"}` : "Review the evidence"
    : quest.status === "pending"
      ? "Start 3-game test"
      : quest.status === "active"
        ? "Continue test"
        : quest.status === "complete"
          ? "View test recap"
          : "Review last game";
  const showChallengeProgress = !isReview && quest.status !== "pending";

  return (
    <article
      className="coach-quest-card"
      data-category={quest.category}
      data-status={quest.status}
      data-mode={mode}
      aria-labelledby={titleId}
    >
      <div className="coach-quest-card__glow" aria-hidden="true" />

      <header className="coach-quest-card__header">
        <div className="coach-quest-card__eyebrow">
          <span className="coach-quest-card__sigil" aria-hidden="true">◆</span>
          <span>{isReview ? "Replay question" : "Next game test"}</span>
          <span className="coach-quest-card__category">{CATEGORY_LABELS[quest.category]}</span>
        </div>
        <span className="coach-quest-card__status">
          <span aria-hidden="true" />
          {isReview && quest.status === "awaiting-review" ? "Ready to review" : STATUS_LABELS[quest.status]}
        </span>
      </header>

      <div className="coach-quest-card__layout">
        <QuestArt art={quest.art} category={quest.category} />

        <section className="coach-quest-card__lesson" aria-label={isReview ? "Replay coaching question" : "Coaching rule"}>
          <div className="coach-quest-card__receipt-line">
            <span>{quest.metric.denominator} captured {quest.metric.denominator === 1 ? "observation" : "observations"}</span>
            <span>Local replay evidence</span>
          </div>
          <h2 id={titleId}>{quest.title}</h2>
          <p className="coach-quest-card__observation">{quest.observation ?? quest.why}</p>

          <section className="coach-quest-prompt">
            <span>{isReview ? "Question to answer" : "Try this next game"}</span>
            <strong>{quest.rule}</strong>
            <small><b>Trigger</b> {quest.when}</small>
          </section>

          <section
            className="coach-quest-metric"
            data-tone={quest.metric.tone ?? "neutral"}
            role="img"
            aria-labelledby={`${chartTitleId} ${chartDescriptionId}`}
          >
            <span id={chartTitleId} className="coach-quest-sr-only">{quest.metric.label}</span>
            <span id={chartDescriptionId} className="coach-quest-sr-only">
              {quest.metric.numerator} out of {quest.metric.denominator}, or {metricRate} percent.
              {quest.metric.comparator && comparatorRate != null ? ` ${quest.metric.comparator.label}: ${quest.metric.comparator.numerator} out of ${quest.metric.comparator.denominator}, or ${comparatorRate} percent.` : ""}
            </span>
            <div className="coach-quest-metric__headline" aria-hidden="true">
              <strong>{quest.metric.numerator}<span> / {quest.metric.denominator}</span></strong>
              <div><span>Captured evidence</span><b>{quest.metric.label}</b></div>
              <em>{metricRate}%</em>
            </div>
            <div className="coach-quest-metric__bar" data-complement={isComplement} aria-hidden="true">
              <i className="coach-quest-metric__bar-primary" style={{ width: `${metricRate}%` }} />
              {isComplement ? <i className="coach-quest-metric__bar-remainder" style={{ width: `${100 - metricRate}%` }} /> : quest.metric.comparator && comparatorRate != null ? <i className="coach-quest-metric__marker" style={{ left: `${comparatorRate}%` }} /> : null}
            </div>
            {quest.metric.comparator && comparatorRate != null ? <div className="coach-quest-metric__legend" aria-hidden="true">
              <span><i /> {quest.metric.numerator} {isComplement ? "matching this pattern" : "observed"}</span>
              <span><i /> {quest.metric.comparator.numerator} {quest.metric.comparator.label.toLocaleLowerCase()}</span>
            </div> : null}
            <p>{quest.metric.receipt ?? `${quest.metric.numerator} of ${quest.metric.denominator} captured observations`}. <b>{isComplement ? "This is one captured split, not a benchmark." : quest.metric.comparator ? `${formatDelta(delta ?? 0)} percentage points from the comparison.` : "This is evidence coverage, not a performance score."}</b></p>
          </section>

          {!isSharePreview ? <details className="coach-quest-measurement">
            <summary>How RiftLite reached this question</summary>
            <p>{quest.why}</p>
            {onContext ? <button type="button" className="coach-quest-link-button" onClick={onContext}>Open the full evidence <ArrowIcon /></button> : null}
          </details> : null}
        </section>
      </div>

      {evidenceActions.length && !isSharePreview ? (
        <details className="coach-quest-evidence">
          <summary>
            <span className="coach-quest-evidence__icon" aria-hidden="true"><PlayIcon /></span>
            <span><strong>{evidenceActions.length} replay {evidenceActions.length === 1 ? "example" : "examples"}</strong><small>Expand to choose a moment and check the surrounding game state.</small></span>
            <ArrowIcon />
          </summary>
          <ul aria-label="Captured replay moments">
            {evidenceActions.map((evidence) => (
              <li key={evidence.id}>
                <button
                  type="button"
                  data-tone={evidence.tone ?? "proof"}
                  disabled={!onReview || isSharePreview}
                  onClick={() => onReview?.(evidence.id)}
                >
                  <span className="coach-quest-evidence__icon" aria-hidden="true"><PlayIcon /></span>
                  <span>
                    <strong>{evidence.label}</strong>
                    {evidence.detail ? <small>{evidence.detail}</small> : null}
                  </span>
                  <ArrowIcon />
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <footer className="coach-quest-footer">
        {showChallengeProgress ? <div className="coach-quest-progress">
          <div className="coach-quest-progress__copy">
            <span>{quest.challenge.title ?? "Three-game challenge"}</span>
            <small>{quest.challenge.label ?? challengeSummary(quest.challenge.games)}</small>
          </div>
          <ol aria-label="Three-game challenge progress">
            {quest.challenge.games.map((game, index) => (
              <li key={index} data-state={game.state} title={game.label ?? GAME_STATE_LABELS[game.state]}>
                <span className="coach-quest-progress__rune" aria-hidden="true">{game.state === "success" ? "✓" : game.state === "missed" ? "×" : game.state === "unsure" ? "?" : index + 1}</span>
                <span className="coach-quest-sr-only">Game {index + 1}: {game.label ?? GAME_STATE_LABELS[game.state]}</span>
              </li>
            ))}
          </ol>
        </div> : !isSharePreview ? <div className="coach-quest-footer__guidance"><span>{isReview ? "Next step" : "Ready when you are"}</span><small>{isReview ? "Review the examples, then decide whether this deserves a 3-game test." : "One rule · three comparable games"}</small></div> : null}

        {!isSharePreview ? (
          <div className="coach-quest-actions">
            {onLab ? <button type="button" className="coach-quest-button coach-quest-button--secondary" onClick={onLab}>Practise in Lab</button> : null}
            {onShare ? <button type="button" className="coach-quest-button coach-quest-button--icon" aria-label="Share coaching quest" onClick={onShare}><ShareIcon /></button> : null}
            {(primaryReview ? onReview : onStart) ? (
              <button
                type="button"
                className="coach-quest-button coach-quest-button--primary"
                onClick={() => primaryReview ? onReview?.(firstEvidenceId) : onStart?.()}
              >
                {primaryLabel} <ArrowIcon />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="coach-quest-share-signature">
            <span>{quest.shareCaption ?? CATEGORY_LABELS[quest.category]}</span>
            <strong>RiftLite <i>Coach</i></strong>
          </div>
        )}
      </footer>
    </article>
  );
}

function QuestArt({ art, category }: { art?: CoachQuestViewModel["art"]; category: CoachQuestCategory }) {
  const candidates = [
    ["card", art?.card],
    ["legend", art?.legend],
    ["battlefield", art?.battlefield]
  ] as const;
  const selected = candidates.find(([, artwork]) => Boolean(artwork?.url));
  const namedFallback = candidates.find(([, artwork]) => Boolean(artwork?.name));
  const kind = selected?.[0] ?? namedFallback?.[0] ?? "category";
  const artwork = selected?.[1];
  const name = artwork?.name ?? namedFallback?.[1]?.name ?? CATEGORY_LABELS[category];
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [artwork?.url]);
  const showImage = Boolean(artwork?.url && !imageFailed);
  return (
    <section className="coach-quest-art" data-kind={kind} data-has-art={showImage} aria-label={`${name} coaching artwork`}>
      {showImage ? <figure>
        <img className="coach-quest-art__backdrop" src={artwork?.url} alt="" aria-hidden="true" onError={() => setImageFailed(true)} />
        <img className="coach-quest-art__image" src={artwork?.url} alt={`${name} ${kind} artwork`} onError={() => setImageFailed(true)} />
        <figcaption><span>{kind}</span><strong>{name}</strong></figcaption>
      </figure> : <div className="coach-quest-art__fallback" role="img" aria-label={`${name} artwork unavailable`}>
        <span aria-hidden="true">{initials(CATEGORY_LABELS[category])}</span>
        <small>Replay coaching</small>
        <strong>{CATEGORY_LABELS[category]}</strong>
        <p>Artwork appears only when RiftLite can verify the captured identity.</p>
      </div>}
      <div className="coach-quest-art__flare" aria-hidden="true" />
    </section>
  );
}

function percentage(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.round(Math.max(0, Math.min(1, numerator / denominator)) * 100);
}

function formatDelta(value: number) {
  if (value === 0) return "Even";
  return `${value > 0 ? "+" : ""}${value}`;
}

function challengeSummary(games: CoachQuestViewModel["challenge"]["games"]) {
  const played = games.filter((game) => game.state === "success" || game.state === "missed" || game.state === "unsure").length;
  const followed = games.filter((game) => game.state === "success").length;
  return played ? `${followed} followed · ${played} reviewed` : "Prove the habit across your next three games";
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "RL";
}

function ArrowIcon() {
  return <svg className="coach-quest-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4-4 4 4-4 4" /></svg>;
}

function PlayIcon() {
  return <svg className="coach-quest-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 8 5-8 5Z" /></svg>;
}

function ShareIcon() {
  return <svg className="coach-quest-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="15" cy="5" r="2" /><circle cx="5" cy="10" r="2" /><circle cx="15" cy="15" r="2" /><path d="m7 9 6-3M7 11l6 3" /></svg>;
}
