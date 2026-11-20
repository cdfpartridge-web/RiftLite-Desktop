import type { TutorialBoard } from "./newPlayerTutorial.js";

/** Give beginners a predictable reading pause; Next move can skip the wait. */
export const GUIDE_SETTLE_MS = 650;
export const GUIDE_NARRATION_MS = 6_000;
export const NEW_PLAYER_NARRATION_KEY = "riftlite.new-player.narration.v1";
export type GuideNarrationMode = "automatic" | "reading" | "manual";
export function parseGuideNarrationMode(value: string | null | undefined): GuideNarrationMode {
  return value === "reading" || value === "manual" ? value : "automatic";
}
export function guideNarrationDelay(instruction: string, mode: GuideNarrationMode = "automatic"): number | null {
  if (mode === "manual") return null;
  if (mode === "reading") return Math.max(10_000, instruction.trim().split(/\s+/).filter(Boolean).length * 450 + 2_000);
  return GUIDE_NARRATION_MS;
}

/** Presentation only: reading another part must never apply another game action. */
export function guideNarrationPages(instruction: string): string[] {
  const text = instruction.trim().replace(/\s+/g, " ");
  if (!text) return [""];
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?:[”’"])?(?=\s|$)|$)/g) ?? [text];
  const parts: string[] = [];
  for (const sentence of sentences) {
    const words = sentence.trim().split(" ");
    if (words.length <= 32) { parts.push(sentence.trim()); continue; }
    // Prefer a natural clause boundary; retain every word and punctuation mark.
    let remainder = sentence.trim();
    while (remainder.split(" ").length > 32) {
      const tokens = remainder.split(" ");
      let end = 32;
      for (let index = 31; index >= 12; index--) {
        if (/[,;:]$/.test(tokens[index])) { end = index + 1; break; }
      }
      parts.push(tokens.slice(0, end).join(" "));
      remainder = tokens.slice(end).join(" ");
    }
    if (remainder) parts.push(remainder);
  }
  const pages: string[] = [];
  for (const part of parts) {
    const previous = pages.at(-1);
    if (previous && `${previous} ${part}`.split(" ").length <= 32) pages[pages.length - 1] += ` ${part}`;
    else pages.push(part);
  }
  return pages;
}

/** Describe observed changes, without inventing an extra rule or future result. */
export function guideMoveOutcome(before: TutorialBoard, after: TutorialBoard): string[] {
  const changes: string[] = [];
  const sideName = (side: "player" | "opponent") => side === "player" ? "Your" : "The guide’s";
  if (before.turnPlayer !== after.turnPlayer) changes.push(after.turnPlayer === "player" ? "It is now your turn." : "It is now the guide’s turn.");
  for (const side of ["player", "opponent"] as const) {
    const old = before.players[side], next = after.players[side];
    const newCards = after.cards.filter(card => card.owner === side && !before.cards.some(previous => previous.instanceId === card.instanceId));
    const newRunes = newCards.filter(card => card.zone === "runes").length;
    const newHand = newCards.filter(card => card.zone === "hand").length;
    if (newRunes) changes.push(`${side === "player" ? "You" : "The guide"} channelled ${newRunes} ${newRunes === 1 ? "rune" : "runes"} onto the table.`);
    if (newHand) changes.push(`${newHand} new ${newHand === 1 ? "card is" : "cards are"} now in ${side === "player" ? "your" : "the guide’s"} hand.`);
    for (const card of newCards.filter(card => card.token && ["base", "battlefield-left", "battlefield-right"].includes(card.zone) && !card.faceDown)) changes.push(`${card.name} is now on the table.`);
    if (old.score !== next.score) changes.push(`${sideName(side)} score is now ${next.score}.`);
    if (old.energy !== next.energy) changes.push(`${sideName(side)} available energy: ${old.energy} → ${next.energy}.`);
    for (const domain of ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] as const) {
      if ((old.power[domain] ?? 0) !== (next.power[domain] ?? 0)) changes.push(`${sideName(side)} ${domain} power: ${old.power[domain] ?? 0} → ${next.power[domain] ?? 0}.`);
    }
  }
  const zoneName = (zone: string) => zone.startsWith("battlefield-") ? after.battlefields.find(item => item.id === zone)?.name ?? "the battlefield" : ({hand:"hand",base:"base",trash:"trash",runes:"the rune area",chain:"the chain",deck:"the main deck","rune-deck":"the rune deck",hidden:"a Hidden slot",banishment:"banishment"} as Record<string,string>)[zone] ?? zone;
  for (const card of after.cards) {
    const old = before.cards.find(item => item.instanceId === card.instanceId);
    if (!old) continue;
    // Concealed identities stay concealed, even in a narration summary.
    const concealed = card.faceDown || card.owner === "opponent" && ["hand", "deck", "hidden"].includes(card.zone);
    const name = concealed ? "A face-down card" : card.name;
    if (old.zone !== card.zone) changes.push(`${name}: ${zoneName(old.zone)} → ${zoneName(card.zone)}.`);
    else if (old.ready !== card.ready) changes.push(`${name} is now ${card.ready ? "ready" : "exhausted"}.`);
    if (!concealed && old.might !== card.might) changes.push(`${name} now has ${card.might} Might.`);
    if (!concealed && old.damage !== card.damage) changes.push(`${name} now has ${card.damage} marked damage.`);
  }
  if (before.chain.length !== after.chain.length) changes.push(after.chain.length ? `${after.chain.length} ${after.chain.length === 1 ? "item is" : "items are"} waiting on the chain.` : "The chain is now empty.");
  if (!changes.length && before.priority !== after.priority) changes.push(after.priority === "player" ? "You now have priority: your chance to act or pass." : after.priority === "opponent" ? "The guide now has priority: its chance to act or pass." : "That response window has finished.");
  if (!changes.length && before.phase !== after.phase) changes.push(`The game is now in ${after.phase}.`);
  return guideNarrationPages(changes.join(" ") || "That step has finished. Look at the table before continuing.");
}

/** Cancellation and a fresh-state guard both matter when navigating or rewinding. */
export function scheduleGuideNarration(delayMs: number, isCurrent: () => boolean, advance: () => void): () => void {
  let cancelled = false;
  const timer = setTimeout(() => {
    if (cancelled || !isCurrent()) return;
    cancelled = true;
    advance();
  }, delayMs);
  return () => { cancelled = true; clearTimeout(timer); };
}
