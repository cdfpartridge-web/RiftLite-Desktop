export type ReplayCardActionKind = "play" | "move" | "draw" | "reveal";

export interface ParsedReplayCardAction {
  kind: ReplayCardActionKind;
  name: string;
  destination: string;
  fromZone?: string;
  toZone?: string;
}

const ZONE_PATTERN = [
  "hand",
  "hidden",
  "exile[ -]?hidden",
  "face[- ]?down",
  "top of (?:the )?deck",
  "deck",
  "base",
  "battlefields?",
  "board",
  "chain",
  "stack",
  "trash",
  "discard(?: pile)?",
  "runes?",
  "rune deck",
  "sideboard",
  "champion",
  "legend",
  "removed",
  "exile",
  "banished"
].join("|");

const FROM_ZONE_ACTION = new RegExp(
  `\\b(Played|Moved|Drew|Revealed)\\s+(.+?)\\s+from\\s+(${ZONE_PATTERN})(?:\\s+to\\s+(.+?))?\\.?$`,
  "i"
);
const KNOWN_DESTINATION_ACTION = new RegExp(
  `\\b(Played|Moved)\\s+(.+?)\\s+to\\s+(${ZONE_PATTERN})\\.?$`,
  "i"
);
const SIMPLE_ACTION = /\b(Played|Drew|Revealed)\s+(.+?)\.?$/i;

const ACTION_PREFIX_BLOCKLIST = /\b(?:and|then|conquered|scored|attacked|defended|won|lost|discarded|recycled)\b/i;
const GENERIC_CARD_QUANTITY = /^(?:(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?cards?(?:\s+from\s+.+)?$/i;

/**
 * Parses the public RiftAtlas action-log wording without treating words such as
 * "to" inside a card name as a destination separator.
 */
export function parseReplayCardActionText(value: string): ParsedReplayCardAction | null {
  const text = value
    .replace(/[\u21ba\u21bb]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, "");
  const fromZone = trustedActionMatch(text, FROM_ZONE_ACTION);
  if (fromZone) {
    const kind = actionKind(fromZone[1]);
    const source = cleanPart(fromZone[3]);
    const destination = cleanPart(fromZone[4] ?? "");
    const name = cleanPart(fromZone[2]);
    if (!isNamedCard(name)) return null;
    return {
      kind,
      name,
      destination,
      fromZone: source || undefined,
      toZone: destination || undefined
    };
  }

  const knownDestination = trustedActionMatch(text, KNOWN_DESTINATION_ACTION);
  if (knownDestination) {
    const destination = cleanPart(knownDestination[3]);
    const name = cleanPart(knownDestination[2]);
    if (!isNamedCard(name)) return null;
    return {
      kind: actionKind(knownDestination[1]),
      name,
      destination,
      toZone: destination || undefined
    };
  }

  const simple = trustedActionMatch(text, SIMPLE_ACTION);
  if (!simple) return null;
  const name = cleanPart(simple[2]);
  if (!isNamedCard(name)) return null;
  return {
    kind: actionKind(simple[1]),
    name,
    destination: ""
  };
}

/**
 * RiftAtlas rows can carry a timestamp or player name before the action. Only
 * accept that small prefix; an incidental trailing clause such as
 * "conquered Vilemaw's Lair and drew 1" is not a named-card action.
 */
function trustedActionMatch(text: string, pattern: RegExp): RegExpMatchArray | null {
  const match = text.match(pattern);
  if (!match || match.index == null) return null;
  const prefix = text.slice(0, match.index).trim().replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, "");
  if (!prefix) return match;
  if (prefix.length > 48 || prefix.split(/\s+/).length > 5 || ACTION_PREFIX_BLOCKLIST.test(prefix)) return null;
  return /^[\p{L}\p{N}_.'’\-\[\] ]+$/u.test(prefix) ? match : null;
}

function isNamedCard(value: string): boolean {
  const name = cleanPart(value);
  if (!name || /^\d+$/.test(name) || GENERIC_CARD_QUANTITY.test(name)) return false;
  return !/^(?:unknown|known) card$/i.test(name);
}

function actionKind(value: string): ReplayCardActionKind {
  const key = value.toLowerCase();
  if (key === "moved") return "move";
  if (key === "drew") return "draw";
  if (key === "revealed") return "reveal";
  return "play";
}

function cleanPart(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[.。]+$/, "").trim();
}
