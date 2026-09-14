import type { MatchDraft } from "./types.js";

/** Private, post-game Atlas history. Never feed these lists into live tracking. */
export const ATLAS_DECK_SECTIONS = [
  "legend",
  "champion",
  "mainDeck",
  "sideboard",
  "battlefields",
  "runes",
] as const;
export type AtlasDeckSection = (typeof ATLAS_DECK_SECTIONS)[number];
export interface AtlasHistoryCard {
  section: AtlasDeckSection;
  name: string;
  quantity: number;
  code?: string;
}
export interface AtlasHistoryDeck {
  availability: "available" | "private" | "unavailable";
  cards: AtlasHistoryCard[];
}
export interface AtlasHistoryMarker {
  gameNumber: number;
  startedAt: number;
  roomCode: string;
}
export interface AtlasHistoryGame extends AtlasHistoryMarker {
  historyId: string;
  myName: string;
  opponentName: string;
  myPoints: number;
  opponentPoints: number;
  me: AtlasHistoryDeck;
  opponent: AtlasHistoryDeck;
}
export interface AtlasMatchHistory {
  version: 1;
  updatedAt: string;
  games: AtlasHistoryGame[];
}

export function canImportAtlasHistory(match: Pick<MatchDraft, "platform" | "source" | "status" | "deletedAt" | "combinedFromMatchIds">): boolean {
  return match.platform === "atlas" && match.status !== "pending-review" && !match.deletedAt &&
    !match.combinedFromMatchIds?.length && !["community", "hub", "team"].includes(match.source ?? "");
}

export function needsAtlasHistoryImport(match: MatchDraft): boolean {
  if (!canImportAtlasHistory(match) || match.status !== "saved") return false;
  const markers = normalizeAtlasHistoryMarkers(match.atlasHistoryMarkers);
  return markers.length > 0 && markers.some((marker) => {
    const game = match.atlasHistory?.games.find((g) =>
      g.gameNumber === marker.gameNumber && g.startedAt === marker.startedAt);
    return !game || game.me.availability === "unavailable" || game.opponent.availability === "unavailable";
  });
}
export interface AtlasHistoryRow {
  id: string;
  startedAt: number;
  endedAt: number;
  gameNumber: number;
  players: Array<{ playerId: string; name: string; isYou: boolean; score: number; deckPrivate: boolean }>;
}
export const atlasRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const text = (v: unknown, max = 160): string =>
  typeof v === "string" && v.trim().length <= max ? v.trim() : "";
const score = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 99;
export function atlasHistoryTimestamp(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) && n > 1_500_000_000_000 && n < 4_000_000_000_000 ? n : 0;
}
export function normalizeAtlasHistoryRows(value: unknown): AtlasHistoryRow[] {
  if (!Array.isArray(value) || value.length > 100) return [];
  return value.flatMap((raw) => {
    const r = atlasRecord(raw);
    if (
      !r ||
      !text(r.id) ||
      r.status === "in_progress" ||
      !atlasHistoryTimestamp(r.startedAt) ||
      !atlasHistoryTimestamp(r.endedAt) ||
      atlasHistoryTimestamp(r.endedAt) < atlasHistoryTimestamp(r.startedAt)
    )
      return [];
    if (![1, 2, 3].includes(Number(r.gameNumber)) || !Array.isArray(r.players) || r.players.length !== 2)
      return [];
    const players = r.players.map(atlasRecord);
    if (
      players.some(
        (p) =>
          !p || !text(p.playerId) || !text(p.name, 120) || !score(p.score) || typeof p.isYou !== "boolean",
      )
    )
      return [];
    if (
      players.filter((p) => p!.isYou === true).length !== 1 ||
      players[0]!.playerId === players[1]!.playerId
    )
      return [];
    return [
      {
        id: text(r.id),
        startedAt: atlasHistoryTimestamp(r.startedAt),
        endedAt: atlasHistoryTimestamp(r.endedAt),
        gameNumber: Number(r.gameNumber),
        players: players.map((p) => ({
          playerId: text(p!.playerId),
          name: text(p!.name, 120),
          isYou: p!.isYou === true,
          score: Number(p!.score),
          deckPrivate: p!.deckPrivate === true,
        })),
      },
    ];
  });
}
export function parseAtlasHistoryDeck(value: unknown): AtlasHistoryCard[] {
  if (typeof value !== "string" || value.length > 32_000) return [];
  const headings: Record<string, AtlasDeckSection> = {
    legend: "legend",
    champion: "champion",
    maindeck: "mainDeck",
    sideboard: "sideboard",
    battlefields: "battlefields",
    runes: "runes",
  };
  let section: AtlasDeckSection | undefined;
  const cards: AtlasHistoryCard[] = [];
  for (const line of value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const heading = headings[line.replace(/[:\s]/g, "").toLowerCase()];
    if (heading) {
      section = heading;
      continue;
    }
    const m = /^(\d{1,2})\s*[xX]?\s+(.+)$/.exec(line);
    if (!section || !m || !text(m[2], 160) || Number(m[1]) < 1 || Number(m[1]) > 20) return [];
    cards.push({ section, name: m[2].trim(), quantity: Number(m[1]) });
    if (cards.length > 160) return [];
  }
  return validAtlasHistoryCards(cards) ? cards : [];
}
export function validAtlasHistoryCards(cards: unknown): cards is AtlasHistoryCard[] {
  if (!Array.isArray(cards) || !cards.length || cards.length > 160) return false;
  let total = 0;
  const seen = new Set<string>();
  for (const c of cards) {
    const r = atlasRecord(c);
    if (
      !r ||
      !ATLAS_DECK_SECTIONS.includes(r.section as AtlasDeckSection) ||
      !text(r.name, 160) ||
      !Number.isInteger(r.quantity) ||
      Number(r.quantity) < 1 ||
      Number(r.quantity) > 20 ||
      (r.code !== undefined && !/^[A-Z]{3}-\d{3}[A-Za-z0-9-]*$/.test(String(r.code)))
    )
      return false;
    const key = `${r.section}|${String(r.name).trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    total += Number(r.quantity);
  }
  return (
    total <= 120 && cards.some((c) => c.section === "legend") && cards.some((c) => c.section === "mainDeck")
  );
}
export function historyDeckForPlayer(
  value: unknown,
  playerId: string,
  privateDeck: boolean,
): AtlasHistoryDeck {
  if (privateDeck) return { availability: "private", cards: [] };
  const entries =
    Array.isArray(value) && value.length <= 4
      ? value.map(atlasRecord).filter((r) => r?.playerId === playerId)
      : [];
  if (entries.length !== 1) return { availability: "unavailable", cards: [] };
  if (entries[0]!.private === true) return { availability: "private", cards: [] };
  const cards = parseAtlasHistoryDeck(entries[0]!.decklist);
  return { availability: cards.length ? "available" : "unavailable", cards };
}
export function normalizeAtlasMatchHistory(value: unknown): AtlasMatchHistory | undefined {
  const r = atlasRecord(value);
  if (
    !r ||
    r.version !== 1 ||
    !atlasHistoryTimestamp(r.updatedAt) ||
    !Array.isArray(r.games) ||
    r.games.length > 3
  )
    return undefined;
  const games: AtlasHistoryGame[] = [];
  for (const candidate of r.games) {
    const g = atlasRecord(candidate);
    if (
      !g ||
      ![1, 2, 3].includes(g.gameNumber as number) ||
      !atlasHistoryTimestamp(g.startedAt) ||
      !text(g.historyId) ||
      !text(g.myName, 120) ||
      !text(g.opponentName, 120) ||
      !score(g.myPoints) ||
      !score(g.opponentPoints) ||
      games.some((x) => x.gameNumber === g.gameNumber)
    )
      return undefined;
    const decks: AtlasHistoryDeck[] = [];
    for (const key of ["me", "opponent"]) {
      const d = atlasRecord(g[key]);
      if (!d || !["available", "private", "unavailable"].includes(String(d.availability))) return undefined;
      if (d.availability === "available" && !validAtlasHistoryCards(d.cards)) return undefined;
      decks.push({
        availability: d.availability as AtlasHistoryDeck["availability"],
        cards:
          d.availability === "available"
            ? (d.cards as AtlasHistoryCard[]).map((c) => ({
                section: c.section,
                name: c.name.trim(),
                quantity: c.quantity,
                ...(c.code ? { code: c.code } : {}),
              }))
            : [],
      });
    }
    games.push({
      gameNumber: Number(g.gameNumber),
      startedAt: atlasHistoryTimestamp(g.startedAt),
      roomCode: text(g.roomCode, 80),
      historyId: text(g.historyId),
      myName: text(g.myName, 120),
      opponentName: text(g.opponentName, 120),
      myPoints: Number(g.myPoints),
      opponentPoints: Number(g.opponentPoints),
      me: decks[0],
      opponent: decks[1],
    });
  }
  return {
    version: 1,
    updatedAt: new Date(atlasHistoryTimestamp(r.updatedAt)).toISOString(),
    games: games.sort((a, b) => a.gameNumber - b.gameNumber),
  };
}
export function atlasSideboardChanges(
  before: AtlasHistoryDeck | undefined,
  after: AtlasHistoryDeck | undefined,
): Array<{ name: string; code?: string; delta: number }> | null {
  if (before?.availability !== "available" || after?.availability !== "available") return null;
  const quantities = new Map<string, { name: string; code?: string; delta: number }>();
  for (const [deck, sign] of [
    [before, -1],
    [after, 1],
  ] as const)
    for (const c of deck.cards.filter((c) => c.section === "mainDeck")) {
      const key = c.name.toLowerCase();
      const old = quantities.get(key);
      quantities.set(key, {
        name: c.name,
        ...(c.code ? { code: c.code } : {}),
        delta: (old?.delta || 0) + sign * c.quantity,
      });
    }
  return [...quantities.values()]
    .filter((c) => c.delta)
    .sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name));
}
/** Deliberately uses only an exact provider timestamp, supported by players/game/scores. */
export function atlasHistoryRowMatches(
  row: AtlasHistoryRow,
  marker: AtlasHistoryMarker,
  match: {
    myName: string;
    opponentName: string;
    games: Array<{ gameNumber: number; myPoints?: number; oppPoints?: number }>;
  },
): boolean {
  const me = row.players.find((p) => p.isYou),
    opp = row.players.find((p) => !p.isYou),
    game = match.games.find((g) => g.gameNumber === marker.gameNumber);
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  return (
    row.startedAt === marker.startedAt &&
    row.gameNumber === marker.gameNumber &&
    Boolean(
      me &&
      opp &&
      game &&
      same(me.name, match.myName) &&
      same(opp.name, match.opponentName) &&
      game.myPoints === me.score &&
      game.oppPoints === opp.score,
    )
  );
}
export function normalizeAtlasHistoryMarkers(value: unknown): AtlasHistoryMarker[] {
  if (!Array.isArray(value) || value.length > 6) return [];
  const markers: AtlasHistoryMarker[] = [];
  for (const entry of value) {
    const marker = atlasRecord(entry);
    if (
      !marker ||
      ![1, 2, 3].includes(marker.gameNumber as number) ||
      !atlasHistoryTimestamp(marker.startedAt)
    )
      return [];
    const startedAt = atlasHistoryTimestamp(marker.startedAt);
    if (!markers.some((m) => m.startedAt === startedAt && m.gameNumber === marker.gameNumber)) {
      markers.push({ gameNumber: Number(marker.gameNumber), startedAt, roomCode: text(marker.roomCode, 80) });
    }
  }
  return markers;
}
/** A later correction to players or scores must not leave a misleading deck attachment. */
export function atlasHistoryForMatch(
  value: unknown,
  match: {
    myName: string;
    opponentName: string;
    games: Array<{ gameNumber: number; myPoints?: number; oppPoints?: number }>;
  },
): AtlasMatchHistory | undefined {
  const history = normalizeAtlasMatchHistory(value);
  if (!history) return undefined;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const games = history.games.filter(
    (h) =>
      match.games.some(
        (g) => g.gameNumber === h.gameNumber && g.myPoints === h.myPoints && g.oppPoints === h.opponentPoints,
      ) &&
      same(match.myName, h.myName) &&
      same(match.opponentName, h.opponentName),
  );
  return games.length ? { ...history, games } : undefined;
}
/** Extracts only history markers from already-recorded gameplay; no deck/card inference. */
export function atlasHistoryMarkersFromRaw(value: unknown): AtlasHistoryMarker[] {
  const input = atlasRecord(value);
  if (!Array.isArray(input?.messages) || input.messages.length > 50_000) return [];
  const byRoom = new Map<string, number>(),
    markers = new Map<number, AtlasHistoryMarker>();
  for (const message of input.messages) {
    const m = atlasRecord(message);
    let p: Record<string, unknown> | null = null;
    try {
      p = atlasRecord(typeof m?.raw === "string" ? JSON.parse(m.raw) : (m?.raw ?? m?.parsed));
    } catch {
      continue;
    }
    if (
      !p ||
      !["room_shell_sync", "authoritative_snapshot", "authoritative_patch_commit"].includes(String(p.type))
    )
      continue;
    const session = atlasRecord(p.sessionDoc),
      snapshot = atlasRecord(p.snapshot),
      patch = atlasRecord(p.patch);
    const room = text(p.gameInstanceId || p.roomCode || session?.roomCode || snapshot?.roomCode, 80);
    const number = Number(session?.gameNumber || snapshot?.gameNumber || byRoom.get(room));
    if (!room || ![1, 2, 3].includes(number)) continue;
    byRoom.set(room, number);
    const fields = [
      snapshot,
      ...(Array.isArray(patch?.operations)
        ? patch.operations
            .map(atlasRecord)
            .filter((o) => o?.op === "set_room_fields")
            .map((o) => atlasRecord(o?.fields))
        : []),
    ];
    for (const f of fields) {
      const startedAt = atlasHistoryTimestamp(f?.gameHistoryStartedAt);
      if (startedAt) markers.set(startedAt, { gameNumber: number, startedAt, roomCode: room });
    }
  }
  return [...markers.values()].sort((a, b) => a.gameNumber - b.gameNumber).slice(0, 6);
}
