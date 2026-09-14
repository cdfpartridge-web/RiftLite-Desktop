import { riftboundCardCodeFromValue } from "../shared/cardIdentity.js";
import { isGeneratedBattlefieldCandidate } from "../shared/generatedBattlefields.js";
import type { BattlefieldCandidate } from "../shared/types.js";

// TCGA classes describe the current zone, not the card's type. Classic uses
// shared host/guest slots; older and FFA layouts use Battlefields* zones.
const BATTLEFIELD_SELECTOR = [
  "myBF1", "myBF2", "myBF3",
  "Battlefields", "Battlefields2", "Battlefields3", "Battlefields4", "Battlefields5"
].map((zone) => `.game-card.${zone}`).join(", ");

export function collectTcgaBattlefieldCandidates(root: ParentNode, capturedAt: string): BattlefieldCandidate[] {
  const elements = Array.from(root.querySelectorAll(BATTLEFIELD_SELECTOR));
  const hasSharedSlots = Boolean(root.querySelector("#section-myBF1, #section-myBF2")) ||
    elements.some((element) => element.classList.contains("myBF1") || element.classList.contains("myBF2"));
  return elements
    // Classic renders cards separately from their zone containers, so staging
    // cards can have a visible-size rect even when their zone has scale: 0.
    // Detect the layout before shared slots fill, excluding all setup choices.
    .filter((element) => !hasSharedSlots || !element.classList.contains("Battlefields"))
    .map((element, listIndex): BattlefieldCandidate => {
      const img = element.querySelector<HTMLImageElement>("img.card-front") ?? element.querySelector<HTMLImageElement>("img");
      const image = img?.currentSrc || img?.src || attr(img, "data-src") || attr(img, "alt");
      const classes = attr(element, "class");
      const rect = element.getBoundingClientRect();
      return {
        // myBF1 is host-owned, not necessarily local. TCGA's owner class works
        // for both seats, even when a battlefield is moved to the other slot.
        side: element.classList.contains("opponent-card") ? "opponent" : "me",
        image,
        code: attr(element, "data-card-id") || attr(img, "data-card-id") || riftboundCardCodeFromValue(image),
        text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
        classes,
        hidden: /card-hidden-yes|ExileHidden/i.test(classes) || isCardBackImage(image),
        capturedAt,
        listIndex,
        index: classNumber(classes, "index"),
        reversedIndex: classNumber(classes, "reversed-index"),
        rect: {
          top: Math.round(rect.top), left: Math.round(rect.left),
          width: Math.round(rect.width), height: Math.round(rect.height)
        }
      };
    })
    .filter((candidate) => Boolean(candidate.image || candidate.code || candidate.text) &&
      // Ignore cards with no rendered area; Classic staging is excluded above.
      Boolean(candidate.rect?.width && candidate.rect?.height));
}

export function battlefieldImageFor(candidates: BattlefieldCandidate[], side: BattlefieldCandidate["side"], requireUnique = false): string {
  const usable = candidates.filter((candidate) => candidate.side === side && !candidate.hidden &&
    candidate.image && !isCardBackImage(candidate.image) && !isGeneratedBattlefieldCandidate(candidate));
  const unique = Array.from(new Map(usable.map((candidate) => [
    candidate.image.trim().toLowerCase().replace(/[?#].*$/, ""), candidate.image
  ])).values());
  return requireUnique && unique.length !== 1 ? "" : unique[0] ?? "";
}

export function battlefieldCodeFor(candidates: BattlefieldCandidate[], side: BattlefieldCandidate["side"], requireUnique = false): string {
  const usable = candidates.filter((candidate) => candidate.side === side && !candidate.hidden &&
    candidate.code && !isGeneratedBattlefieldCandidate(candidate));
  const unique = [...new Set(usable.map((candidate) => riftboundCardCodeFromValue(candidate.code)).filter(Boolean))];
  return requireUnique && unique.length !== 1 ? "" : unique[0] ?? "";
}

function attr(element: Element | null, name: string): string {
  return element?.getAttribute(name)?.trim() ?? "";
}

function classNumber(classes: string, name: string): number | undefined {
  const match = classes.match(new RegExp(`(?:^|\\s)${name}-(\\d+)(?:\\s|$)`));
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

function isCardBackImage(value: string): boolean {
  return /cardback|card-back|back-black|back\.png/i.test(value);
}
