import { deckSnapshotHash, normalizeDeckGuideReviewBaseline } from "./deckNotebook.js";
import type { DeckGuideReviewBaseline, DeckGuideSection, DeckMatchupGuide, DeckNotebook, SavedDeck } from "./types.js";

export type DeckGuideReviewStage = "mulligan" | "sideboard" | "battlefields";
export interface DeckGuideReviewIssue {
  id: string;
  stage: DeckGuideReviewStage;
  section: string;
  cardName: string;
  message: string;
  blocking: boolean;
}
export interface DeckGuideReviewReport {
  legend: string;
  label: string;
  hasContent: boolean;
  status: "unavailable" | "unreviewed" | "current" | "changed";
  deckChanged: boolean;
  reviewedAt?: string;
  issues: DeckGuideReviewIssue[];
  canMarkReviewed: boolean;
}

type InventoryCard = DeckGuideReviewBaseline["cards"][number];
type SectionKey = "mainDeck" | "sideboard" | "battlefields";
const SECTIONS: SectionKey[] = ["mainDeck", "sideboard", "battlefields"];

// A print/artwork change does not change which named card a plan refers to.
function cardKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function inventory(deck: SavedDeck): InventoryCard[] | null {
  try {
    const snapshot = JSON.parse(deck.snapshotJson) as Record<string, unknown>;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
    const sections: Record<string, unknown> = { ...snapshot, mainDeck: snapshot.mainDeck ?? snapshot.main_deck };
    if (!SECTIONS.every((section) => Array.isArray(sections[section]))) return null;
    const cards = new Map<string, InventoryCard>();
    for (const section of SECTIONS) {
      for (const entry of sections[section] as unknown[]) {
        if (!entry || typeof entry !== "object") return null;
        const raw = entry as Record<string, unknown>;
        if (typeof raw.name !== "string" || !raw.name.trim()) return null;
        const qty = Number(raw.qty ?? 1);
        if (!Number.isInteger(qty) || qty < 1) return null;
        const key = cardKey(raw.name);
        const card = cards.get(key) ?? { key, name: raw.name.trim(), mainDeck: 0, sideboard: 0, battlefields: 0 };
        card[section] += qty;
        cards.set(key, card);
      }
    }
    return [...cards.values()].sort((left, right) => left.key.localeCompare(right.key));
  } catch {
    return null;
  }
}

export function createDeckGuideReviewBaseline(deck: SavedDeck, reviewedAt = new Date().toISOString()): DeckGuideReviewBaseline | null {
  const cards = inventory(deck);
  if (!cards || !Number.isFinite(Date.parse(reviewedAt))) return null;
  return { version: 1, snapshotHash: deckSnapshotHash(deck.snapshotJson), reviewedAt, cards };
}

export function deckGuideHasContent(guide: DeckMatchupGuide): boolean {
  return guideSections(guide).some(({ section }) => section.cards.length || section.note.trim()) ||
    Boolean(guide.sideboard.note.trim() || guide.battlefields.note.trim() || guide.notes.length);
}

export function reviewDeckGuide(deck: SavedDeck, guide: DeckMatchupGuide): DeckGuideReviewReport {
  const current = createDeckGuideReviewBaseline(deck);
  const baseline = normalizeDeckGuideReviewBaseline(guide.reviewBaseline);
  const hasContent = deckGuideHasContent(guide);
  const report: DeckGuideReviewReport = {
    legend: guide.legend || "default",
    label: guide.legend || "All matchups · default",
    hasContent,
    status: current ? baseline ? "current" : "unreviewed" : "unavailable",
    deckChanged: Boolean(current && baseline && current.snapshotHash !== baseline.snapshotHash),
    ...(baseline ? { reviewedAt: baseline.reviewedAt } : {}),
    issues: [],
    canMarkReviewed: Boolean(current && hasContent)
  };
  if (!current || !hasContent) return report;
  const nowCards = new Map(current.cards.map((card) => [card.key, card]));
  const oldCards = new Map((baseline?.cards ?? []).map((card) => [card.key, card]));
  for (const { stage, label, section, zones } of guideSections(guide)) {
    for (const card of section.cards) {
      const key = cardKey(card.cardName);
      const now = nowCards.get(key);
      const before = oldCards.get(key);
      const available = zones.reduce((sum, zone) => sum + (now?.[zone] ?? 0), 0);
      const previous = zones.reduce((sum, zone) => sum + (before?.[zone] ?? 0), 0);
      const zoneLabel = stage === "mulligan" ? "main deck or sideboard" : zones[0] === "mainDeck" ? "main deck" : zones[0] === "sideboard" ? "sideboard" : "battlefields";
      let message = "";
      let blocking = false;
      if (available === 0) {
        message = `${card.cardName} is no longer in the ${zoneLabel}. The saved reference and notes are preserved.`;
        if (!baseline) message = `${card.cardName} is not in the current ${zoneLabel}. No previously reviewed deck is available for comparison.`;
        blocking = true;
      } else if (card.qty > available) {
        message = `${card.cardName}: this plan lists ${card.qty}, but only ${available} ${available === 1 ? "copy is" : "copies are"} in the ${zoneLabel}.`;
        blocking = true;
      } else if (baseline && previous !== available) {
        message = `${card.cardName}: ${previous} → ${available} copies in the ${zoneLabel} since this guide was reviewed.`;
      } else if (baseline && stage === "mulligan" && (before?.mainDeck ?? 0) !== (now?.mainDeck ?? 0)) {
        message = `${card.cardName} moved between the main deck and sideboard. Check when this mulligan advice applies.`;
      }
      if (message) report.issues.push({ id: `${stage}:${label}:${card.id}`, stage, section: label, cardName: card.cardName, message, blocking });
    }
  }
  // Lists may describe alternative swaps, so do not invent a complete plan by
  // adding every group together. Per-card availability is always checkable.
  if (report.issues.length) report.status = "changed";
  report.canMarkReviewed = report.canMarkReviewed && !report.issues.some((issue) => issue.blocking);
  return report;
}

export function reviewDeckNotebook(deck: SavedDeck, notebook: DeckNotebook): DeckGuideReviewReport[] {
  return [notebook.defaultGuide, ...notebook.matchupGuides].map((guide) => reviewDeckGuide(deck, guide)).filter((report) => report.hasContent);
}

export function markDeckGuideReviewed(deck: SavedDeck, guide: DeckMatchupGuide, reviewedAt = new Date().toISOString()): DeckMatchupGuide {
  if (!reviewDeckGuide(deck, guide).canMarkReviewed) throw new Error("Resolve unavailable cards or quantities before marking this guide reviewed.");
  const reviewBaseline = createDeckGuideReviewBaseline(deck, reviewedAt);
  if (!reviewBaseline) throw new Error("The current deck could not be checked. Refresh the deck and try again.");
  return { ...guide, reviewBaseline, updatedAt: reviewedAt };
}

function guideSections(guide: DeckMatchupGuide): Array<{ stage: DeckGuideReviewStage; label: string; section: DeckGuideSection; zones: SectionKey[] }> {
  return [
    { stage: "mulligan", label: "Keep", section: guide.mulligan.keep, zones: ["mainDeck", "sideboard"] },
    { stage: "mulligan", label: "Consider", section: guide.mulligan.consider, zones: ["mainDeck", "sideboard"] },
    { stage: "mulligan", label: "Avoid", section: guide.mulligan.avoid, zones: ["mainDeck", "sideboard"] },
    { stage: "sideboard", label: "Bring in", section: guide.sideboard.in, zones: ["sideboard"] },
    { stage: "sideboard", label: "Take out", section: guide.sideboard.out, zones: ["mainDeck"] },
    { stage: "battlefields", label: "Game 1", section: guide.battlefields.game1, zones: ["battlefields"] },
    { stage: "battlefields", label: "Going first", section: guide.battlefields.game1First, zones: ["battlefields"] },
    { stage: "battlefields", label: "Going second", section: guide.battlefields.game1Second, zones: ["battlefields"] }
  ];
}
