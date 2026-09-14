import React from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck } from "lucide-react";
import type { DeckGuideReviewReport, DeckGuideReviewStage } from "../shared/deckGuideReview";
import "./styles/deckGuideReview.css";

export function DeckGuideReviewNotice({ reports, current, busy, dirty, onOpen, onMarkReviewed }: {
  reports: DeckGuideReviewReport[];
  current: DeckGuideReviewReport;
  busy: boolean;
  dirty: boolean;
  onOpen: (legend: string, stage?: DeckGuideReviewStage) => void;
  onMarkReviewed: () => void;
}) {
  const affected = reports.filter((report) => report.issues.length > 0);
  if (!current.hasContent && !affected.length) return null;
  const needsReview = current.status === "changed" || current.status === "unreviewed";
  return <section className="deck-guide-review" aria-label="Check plans after deck changes" data-state={current.status}>
    <header>
      {affected.length ? <AlertTriangle size={19} /> : <ClipboardCheck size={19} />}
      <div>
        <strong>{affected.length ? `${affected.length} ${affected.length === 1 ? "plan needs" : "plans need"} a closer look` : "Keep your plan in step with your deck"}</strong>
        <p>Check the changes, update any affected cards, then mark this guide reviewed. Your saved notes stay intact.</p>
      </div>
    </header>
    {affected.length > 0 ? <nav className="deck-guide-review-links" aria-label="Affected matchup plans">
      {affected.map((report) => <button type="button" className="secondary" key={report.legend}
        data-active={report.legend === current.legend} onClick={() => onOpen(report.legend, report.issues[0]?.stage)}>
        {report.label}<span>{report.issues.length}</span><ArrowRight size={14} />
      </button>)}
    </nav> : null}
    {current.hasContent ? <>
      <div className="deck-guide-review-context">
        <strong>{current.label}</strong>
        <span>{current.status === "unavailable" ? "Deck details are incomplete. Refresh the deck before checking this plan."
          : !current.reviewedAt ? "No previously reviewed deck is available. This check uses your current list."
            : `Last reviewed ${new Date(current.reviewedAt).toLocaleDateString()}.${current.deckChanged ? " The deck has changed since then." : ""}`}</span>
      </div>
      {current.issues.length ? <ul className="deck-guide-review-issues">
        {current.issues.map((issue) => <li key={issue.id}>
          <div><small>{issue.stage === "battlefields" ? "Battlefields" : issue.stage === "sideboard" ? "Sideboard" : "Mulligan"} · {issue.section}</small><span>{issue.message}</span></div>
          <button type="button" className="secondary" onClick={() => onOpen(current.legend, issue.stage)}>Review {issue.section}<ArrowRight size={13} /></button>
        </li>)}
      </ul> : current.status !== "unavailable" ? <p className="deck-guide-review-clear"><CheckCircle2 size={15} />The referenced cards and quantities fit the current list.</p> : null}
      {current.issues.some((issue) => issue.blocking) ? <p className="deck-guide-review-hint">Update or remove unavailable references before marking this guide reviewed. You can still save it as a work in progress.</p> : null}
      {(needsReview || current.deckChanged || dirty) ? <div className="deck-guide-review-footer">
        <button type="button" className="secondary" disabled={busy || !current.canMarkReviewed} onClick={onMarkReviewed}>
          <CheckCircle2 size={15} />{busy ? "Saving…" : "Save & mark reviewed"}
        </button>
        <small>This records the current deck as this guide’s new comparison point.</small>
      </div> : null}
    </> : null}
  </section>;
}
