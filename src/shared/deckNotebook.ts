import { normalizeLegendName } from "./legendNames.js";
import type {
  DeckGuideCardRef,
  DeckGuideNote,
  DeckGuideSection,
  DeckCardWatchItem,
  DeckMatchupGuide,
  DeckNotebook,
  DeckSnapshot,
  DeckVersionEntry,
  MatchDraft,
  MatchGame,
  SavedDeck
} from "./types.js";

export interface DeckNotebookCardOption {
  cardKey: string;
  cardName: string;
  cardId: string;
  imageUrl: string;
  qty: number;
}

export interface DeckVersionPerformanceRow {
  version: DeckVersionEntry;
  matches: MatchDraft[];
  completed: number;
  record: string;
  winRateLabel: string;
  bo1: number;
  bo3: number;
  firstRecord: string;
  secondRecord: string;
  bestMatchup: string;
  worstMatchup: string;
}

type ResultLike = "Win" | "Loss" | "Draw" | "Incomplete";

interface NotebookRecordStats {
  total: number;
  wins: number;
  losses: number;
  draws: number;
  decisive: number;
  record: string;
  winRate: number;
  winRateLabel: string;
}

export function emptyDeckNotebook(deckId: string): DeckNotebook {
  return {
    deckId,
    updatedAt: "",
    goals: [],
    versions: [],
    watchlist: [],
    defaultGuide: emptyDeckMatchupGuide(""),
    matchupGuides: []
  };
}

export function emptyDeckMatchupGuide(legend: string): DeckMatchupGuide {
  const canonical = normalizeLegendName(legend);
  const isDefault = !canonical;
  return {
    id: makeStableId("guide", isDefault ? "default" : canonical),
    legend: isDefault ? "" : canonical,
    legendKey: isDefault ? "default" : normalizedText(canonical),
    updatedAt: "",
    mulligan: {
      keep: emptyGuideSection(),
      consider: emptyGuideSection(),
      avoid: emptyGuideSection()
    },
    sideboard: {
      in: emptyGuideSection(),
      out: emptyGuideSection(),
      note: ""
    },
    battlefields: {
      game1: emptyGuideSection(),
      game1First: emptyGuideSection(),
      game1Second: emptyGuideSection(),
      note: ""
    },
    notes: []
  };
}

export function resolveDeckMatchupGuide(notebook: DeckNotebook, opponentLegend: string): { guide: DeckMatchupGuide; source: "default" | "matchup" } {
  const normalized = normalizeLegendName(opponentLegend);
  const defaultGuide = normalizeMatchupGuide(notebook.defaultGuide, "");
  const matchup = normalized
    ? notebook.matchupGuides.find((guide) => normalizeLegendName(guide.legend) === normalized)
    : undefined;
  if (!matchup) {
    return { guide: defaultGuide, source: "default" };
  }
  return { guide: mergeMatchupGuide(defaultGuide, normalizeMatchupGuide(matchup, normalized)), source: "matchup" };
}

export function normalizeDeckNotebook(deckId: string, value: Partial<DeckNotebook> | null | undefined): DeckNotebook {
  const notebook = value ?? {};
  return {
    deckId,
    updatedAt: text(notebook.updatedAt),
    goals: Array.isArray(notebook.goals) ? notebook.goals.map((goal) => ({
      id: text(goal.id) || makeStableId("goal", goal.createdAt || goal.text),
      text: text(goal.text),
      status: (goal.status === "Done" || goal.status === "Paused" ? goal.status : "Active") as DeckNotebook["goals"][number]["status"],
      createdAt: text(goal.createdAt) || new Date().toISOString(),
      ...(goal.updatedAt ? { updatedAt: text(goal.updatedAt) } : {})
    })).filter((goal) => goal.text) : [],
    versions: Array.isArray(notebook.versions) ? notebook.versions.map((version) => ({
      id: text(version.id) || makeStableId("version", version.snapshotHash || version.importedAt),
      snapshotHash: text(version.snapshotHash),
      title: text(version.title),
      legend: normalizeLegendName(version.legend),
      sourceKey: text(version.sourceKey),
      sourceUrl: text(version.sourceUrl),
      importedAt: text(version.importedAt) || new Date().toISOString(),
      summary: text(version.summary)
    })).filter((version) => version.snapshotHash) : [],
    watchlist: Array.isArray(notebook.watchlist) ? notebook.watchlist.map(normalizeWatchItem).filter(Boolean) as DeckCardWatchItem[] : [],
    defaultGuide: normalizeMatchupGuide(notebook.defaultGuide, ""),
    matchupGuides: Array.isArray(notebook.matchupGuides)
      ? uniqueMatchupGuides(notebook.matchupGuides.map((guide) => normalizeMatchupGuide(guide, guide.legend)).filter((guide) => guide.legend))
      : []
  };
}

export function deckNotebookWithCurrentVersion(notebook: DeckNotebook, deck: SavedDeck, importedAt = deck.lastImportedAt): DeckNotebook {
  const currentHash = deckSnapshotHash(deck.snapshotJson);
  if (!currentHash) {
    return notebook;
  }
  if (notebook.versions.some((version) => version.snapshotHash === currentHash)) {
    return notebook;
  }
  const parsed = parseDeckSnapshot(deck.snapshotJson);
  const versionNumber = notebook.versions.length + 1;
  const entry: DeckVersionEntry = {
    id: makeStableId("version", `${deck.id}:${currentHash}`),
    snapshotHash: currentHash,
    title: deck.title,
    legend: normalizeLegendName(deck.legend || parsed.legend || ""),
    sourceKey: deck.sourceKey || deck.id,
    sourceUrl: deck.sourceUrl,
    importedAt: importedAt || new Date().toISOString(),
    summary: `Version ${versionNumber} imported`
  };
  return {
    ...notebook,
    versions: [...notebook.versions, entry],
    updatedAt: new Date().toISOString()
  };
}

export function deckSnapshotHash(snapshotJson: string): string {
  const raw = snapshotJson.trim();
  if (!raw) {
    return "";
  }
  let stable = raw;
  try {
    stable = stableStringify(JSON.parse(raw));
  } catch {
    stable = raw.replace(/\s+/g, " ");
  }
  return `d${hashString(stable)}`;
}

export function deckNotebookCardOptions(deck: SavedDeck): DeckNotebookCardOption[] {
  const snapshot = parseDeckSnapshot(deck.snapshotJson);
  const sections = [
    ...(snapshot.mainDeck ?? []),
    ...(snapshot.sideboard ?? []),
    ...(snapshot.runes ?? [])
  ];
  const seen = new Map<string, DeckNotebookCardOption>();
  for (const entry of sections) {
    const name = text(entry.name);
    if (!name) {
      continue;
    }
    const cardId = text(entry.cardId);
    const key = cardKeyFor(name, cardId);
    if (!seen.has(key)) {
      seen.set(key, {
        cardKey: key,
        cardName: name,
        cardId,
        imageUrl: text(entry.imageUrl),
        qty: entryQty(entry)
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.cardName.localeCompare(b.cardName));
}

export function deckNotebookMainDeckCardOptions(deck: SavedDeck): DeckNotebookCardOption[] {
  return deckNotebookSectionCardOptions(deck, "mainDeck");
}

export function deckNotebookMulliganCardOptions(deck: SavedDeck): DeckNotebookCardOption[] {
  const seen = new Map<string, DeckNotebookCardOption>();
  for (const option of [
    ...deckNotebookMainDeckCardOptions(deck),
    ...deckNotebookSideboardCardOptions(deck)
  ]) {
    const existing = seen.get(option.cardKey);
    seen.set(option.cardKey, existing ? { ...existing, qty: existing.qty + option.qty } : option);
  }
  return [...seen.values()].sort((a, b) => a.cardName.localeCompare(b.cardName));
}

export function deckNotebookSideboardCardOptions(deck: SavedDeck): DeckNotebookCardOption[] {
  return deckNotebookSectionCardOptions(deck, "sideboard");
}

export function deckNotebookBattlefieldCardOptions(deck: SavedDeck): DeckNotebookCardOption[] {
  return deckNotebookSectionCardOptions(deck, "battlefields");
}

export function sanitizeDeckNotebookForDeck(notebook: DeckNotebook, deck: SavedDeck): DeckNotebook {
  const allowedAll = new Set(deckNotebookCardOptions(deck).map((card) => card.cardKey));
  const allowedMain = new Set(deckNotebookMainDeckCardOptions(deck).map((card) => card.cardKey));
  const allowedMulligan = new Set(deckNotebookMulliganCardOptions(deck).map((card) => card.cardKey));
  const allowedSide = new Set(deckNotebookSideboardCardOptions(deck).map((card) => card.cardKey));
  const allowedBattlefields = new Set(deckNotebookBattlefieldCardOptions(deck).map((card) => card.cardKey));
  return {
    ...notebook,
    watchlist: notebook.watchlist.filter((item) => allowedAll.has(item.cardKey)),
    defaultGuide: sanitizeGuideCards(notebook.defaultGuide, allowedMain, allowedMulligan, allowedSide, allowedBattlefields),
    matchupGuides: notebook.matchupGuides.map((guide) => sanitizeGuideCards(guide, allowedMain, allowedMulligan, allowedSide, allowedBattlefields))
  };
}

export function buildDeckVersionPerformance(deck: SavedDeck, notebook: DeckNotebook, matches: MatchDraft[]): DeckVersionPerformanceRow[] {
  const versions = [...notebook.versions].sort((a, b) => dateMs(a.importedAt) - dateMs(b.importedAt));
  if (!versions.length) {
    return [];
  }
  return versions.map((version, index) => {
    const assigned = matches.filter((match) => matchBelongsToVersion(deck, versions, version, index, match));
    const completed = assigned.filter(isCompletedMatch);
    const stats = recordStats(completed.map((match) => match.result));
    const first = gameStatsForSeat(completed, "1st");
    const second = gameStatsForSeat(completed, "2nd");
    return {
      version,
      matches: assigned,
      completed: completed.length,
      record: stats.record,
      winRateLabel: stats.winRateLabel,
      bo1: completed.filter((match) => match.format === "Bo1").length,
      bo3: completed.filter((match) => match.format === "Bo3").length,
      firstRecord: first.total ? `${first.record} (${first.winRateLabel})` : "No data",
      secondRecord: second.total ? `${second.record} (${second.winRateLabel})` : "No data",
      bestMatchup: matchupLabel(completed, "best"),
      worstMatchup: matchupLabel(completed, "worst")
    };
  });
}

function matchBelongsToVersion(deck: SavedDeck, versions: DeckVersionEntry[], version: DeckVersionEntry, index: number, match: MatchDraft): boolean {
  const matchHash = deckSnapshotHash(match.deckSnapshotJson ?? "");
  if (matchHash) {
    return matchHash === version.snapshotHash;
  }
  if (!matchLooksLikeDeck(deck, match)) {
    return false;
  }
  const matchDate = dateMs(match.capturedAt);
  const start = dateMs(version.importedAt);
  const nextStart = versions[index + 1] ? dateMs(versions[index + 1].importedAt) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(matchDate)) {
    return index === versions.length - 1;
  }
  if (matchDate >= start && matchDate < nextStart) {
    return true;
  }
  return index === 0 && matchDate < start;
}

function matchLooksLikeDeck(deck: SavedDeck, match: MatchDraft): boolean {
  const deckKeys = [deck.sourceKey, deck.id].map(normalizedKey).filter(Boolean);
  const matchKey = normalizedKey(match.deckSourceKey || match.deckSourceId);
  if (matchKey) {
    return deckKeys.includes(matchKey);
  }
  return normalizedText(deck.title) === normalizedText(match.deckName) && normalizeLegendName(deck.legend) === normalizeLegendName(match.myChampion);
}

function gameStatsForSeat(matches: MatchDraft[], seat: "1st" | "2nd"): NotebookRecordStats {
  const games = matches.flatMap((match) => normalizedGames(match)).filter((game) => game.wentFirst === seat);
  return recordStats(games.map((game) => game.result || "Incomplete"));
}

function normalizedGames(match: MatchDraft): MatchGame[] {
  if (match.games.length) {
    return match.games;
  }
  return [{
    gameNumber: 1,
    result: match.result,
    myBattlefield: match.myBattlefield,
    oppBattlefield: match.opponentBattlefield,
    wentFirst: ""
  }];
}

function matchupLabel(matches: MatchDraft[], mode: "best" | "worst"): string {
  const grouped = new Map<string, ResultLike[]>();
  for (const match of matches) {
    const legend = normalizeLegendName(match.opponentChampion);
    if (!legend) {
      continue;
    }
    grouped.set(legend, [...(grouped.get(legend) ?? []), match.result]);
  }
  const rows = [...grouped.entries()].map(([legend, results]) => ({ legend, ...recordStats(results) }));
  if (!rows.length) {
    return "No data";
  }
  rows.sort((a, b) => {
    const rate = mode === "best" ? b.winRate - a.winRate : a.winRate - b.winRate;
    return rate || b.total - a.total || a.legend.localeCompare(b.legend);
  });
  const chosen = rows[0];
  return `${chosen.legend} ${chosen.winRateLabel} (${chosen.record})`;
}

function recordStats(results: ResultLike[]): NotebookRecordStats {
  const completed = results.filter((result) => result !== "Incomplete");
  const wins = completed.filter((result) => result === "Win").length;
  const losses = completed.filter((result) => result === "Loss").length;
  const draws = completed.filter((result) => result === "Draw").length;
  const decisive = wins + losses;
  const winRate = decisive ? Math.round((wins / decisive) * 100) : 0;
  return {
    total: completed.length,
    wins,
    losses,
    draws,
    decisive,
    record: `${wins}-${losses}${draws ? `-${draws}` : ""}`,
    winRate,
    winRateLabel: completed.length ? `${winRate}%` : "No data"
  };
}

function isCompletedMatch(match: MatchDraft): boolean {
  return match.result === "Win" || match.result === "Loss" || match.result === "Draw";
}

function parseDeckSnapshot(snapshotJson: string): DeckSnapshot {
  try {
    const parsed = JSON.parse(snapshotJson) as Partial<DeckSnapshot> & { main_deck?: DeckSnapshot["mainDeck"] };
    return {
      title: text(parsed.title),
      legend: normalizeLegendName(parsed.legend),
      legendKey: text(parsed.legendKey),
      sourceUrl: text(parsed.sourceUrl),
      sourceKey: text(parsed.sourceKey),
      runes: Array.isArray(parsed.runes) ? parsed.runes : [],
      battlefields: Array.isArray(parsed.battlefields) ? parsed.battlefields : [],
      mainDeck: Array.isArray(parsed.mainDeck) ? parsed.mainDeck : Array.isArray(parsed.main_deck) ? parsed.main_deck : [],
      sideboard: Array.isArray(parsed.sideboard) ? parsed.sideboard : []
    };
  } catch {
    return {
      title: "",
      legend: "",
      legendKey: "",
      sourceUrl: "",
      sourceKey: "",
      runes: [],
      battlefields: [],
      mainDeck: [],
      sideboard: []
    };
  }
}

function deckNotebookSectionCardOptions(deck: SavedDeck, section: "mainDeck" | "sideboard" | "battlefields"): DeckNotebookCardOption[] {
  const snapshot = parseDeckSnapshot(deck.snapshotJson);
  const seen = new Map<string, DeckNotebookCardOption>();
  for (const entry of snapshot[section] ?? []) {
    const name = text(entry.name);
    if (!name) {
      continue;
    }
    const cardId = text(entry.cardId);
    const key = cardKeyFor(name, cardId);
    if (!seen.has(key)) {
      seen.set(key, {
        cardKey: key,
        cardName: name,
        cardId,
        imageUrl: text(entry.imageUrl),
        qty: entryQty(entry)
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.cardName.localeCompare(b.cardName));
}

function emptyGuideSection(): DeckGuideSection {
  return {
    cards: [],
    note: ""
  };
}

function normalizeMatchupGuide(value: Partial<DeckMatchupGuide> | null | undefined, legend: string): DeckMatchupGuide {
  const source = value ?? {};
  const normalizedLegend = normalizeLegendName(legend || source.legend);
  const base = emptyDeckMatchupGuide(normalizedLegend);
  return {
    id: text(source.id) || base.id,
    legend: normalizedLegend,
    legendKey: normalizedLegend ? normalizedText(normalizedLegend) : "default",
    updatedAt: text(source.updatedAt),
    mulligan: {
      keep: normalizeGuideSection(source.mulligan?.keep),
      consider: normalizeGuideSection(source.mulligan?.consider),
      avoid: normalizeGuideSection(source.mulligan?.avoid)
    },
    sideboard: {
      in: normalizeGuideSection(source.sideboard?.in),
      out: normalizeGuideSection(source.sideboard?.out),
      note: text(source.sideboard?.note)
    },
    battlefields: {
      game1: normalizeGuideSection(source.battlefields?.game1),
      game1First: normalizeGuideSection(source.battlefields?.game1First),
      game1Second: normalizeGuideSection(source.battlefields?.game1Second),
      note: text(source.battlefields?.note)
    },
    notes: Array.isArray(source.notes) ? source.notes.map(normalizeGuideNote).filter(Boolean) as DeckGuideNote[] : []
  };
}

function normalizeGuideSection(value: Partial<DeckGuideSection> | null | undefined): DeckGuideSection {
  return {
    cards: Array.isArray(value?.cards) ? value.cards.map(normalizeGuideCard).filter(Boolean) as DeckGuideCardRef[] : [],
    note: text(value?.note)
  };
}

function normalizeGuideCard(value: Partial<DeckGuideCardRef> | null | undefined): DeckGuideCardRef | null {
  const record = value && typeof value === "object" ? value as Partial<DeckGuideCardRef> & Record<string, unknown> : {};
  const cardName = text(value?.cardName);
  const cardId = text(value?.cardId);
  const cardKey = text(value?.cardKey) || cardKeyFor(cardName, cardId);
  if (!cardName || !cardKey) {
    return null;
  }
  const qty = Number(value?.qty ?? 1);
  const priority = Number(record.priority);
  return {
    id: text(value?.id) || makeStableId("guide-card", `${cardKey}:${cardName}`),
    cardKey,
    cardName,
    cardId,
    imageUrl: text(value?.imageUrl),
    qty: Number.isFinite(qty) ? Math.max(1, Math.trunc(qty)) : 1,
    note: text(value?.note),
    groupName: text(record.groupName ?? record.group ?? record.role),
    groupTarget: text(record.groupTarget ?? record.target ?? record.keepTarget),
    groupNote: text(record.groupNote ?? record.group_note ?? record.roleNote),
    priority: Number.isFinite(priority) && priority > 0 ? Math.trunc(priority) : undefined
  };
}

function normalizeGuideNote(value: Partial<DeckGuideNote> | null | undefined): DeckGuideNote | null {
  const textValue = text(value?.text);
  if (!textValue) {
    return null;
  }
  return {
    id: text(value?.id) || makeStableId("guide-note", `${textValue}:${value?.createdAt}`),
    text: textValue,
    createdAt: text(value?.createdAt) || new Date().toISOString(),
    updatedAt: text(value?.updatedAt),
    source: value?.source === "play" ? "play" : "deck"
  };
}

function mergeMatchupGuide(defaultGuide: DeckMatchupGuide, matchup: DeckMatchupGuide): DeckMatchupGuide {
  return {
    ...matchup,
    mulligan: {
      keep: sectionWithDefault(defaultGuide.mulligan.keep, matchup.mulligan.keep),
      consider: sectionWithDefault(defaultGuide.mulligan.consider, matchup.mulligan.consider),
      avoid: sectionWithDefault(defaultGuide.mulligan.avoid, matchup.mulligan.avoid)
    },
    sideboard: {
      in: sectionWithDefault(defaultGuide.sideboard.in, matchup.sideboard.in),
      out: sectionWithDefault(defaultGuide.sideboard.out, matchup.sideboard.out),
      note: matchup.sideboard.note || defaultGuide.sideboard.note
    },
    battlefields: {
      game1: sectionWithDefault(defaultGuide.battlefields.game1, matchup.battlefields.game1),
      game1First: sectionWithDefault(defaultGuide.battlefields.game1First, matchup.battlefields.game1First),
      game1Second: sectionWithDefault(defaultGuide.battlefields.game1Second, matchup.battlefields.game1Second),
      note: matchup.battlefields.note || defaultGuide.battlefields.note
    },
    notes: [...defaultGuide.notes, ...matchup.notes]
  };
}

function sectionWithDefault(defaultSection: DeckGuideSection, matchupSection: DeckGuideSection): DeckGuideSection {
  return {
    cards: matchupSection.cards.length ? matchupSection.cards : defaultSection.cards,
    note: matchupSection.note || defaultSection.note
  };
}

function uniqueMatchupGuides(guides: DeckMatchupGuide[]): DeckMatchupGuide[] {
  const seen = new Map<string, DeckMatchupGuide>();
  for (const guide of guides) {
    if (guide.legendKey && guide.legendKey !== "default") {
      seen.set(guide.legendKey, guide);
    }
  }
  return [...seen.values()].sort((a, b) => a.legend.localeCompare(b.legend));
}

function sanitizeGuideCards(
  guide: DeckMatchupGuide,
  allowedMain: Set<string>,
  allowedMulligan: Set<string>,
  allowedSide: Set<string>,
  allowedBattlefields: Set<string>
): DeckMatchupGuide {
  return {
    ...guide,
    mulligan: {
      keep: filterGuideSection(guide.mulligan.keep, allowedMulligan),
      consider: filterGuideSection(guide.mulligan.consider, allowedMulligan),
      avoid: filterGuideSection(guide.mulligan.avoid, allowedMulligan)
    },
    sideboard: {
      ...guide.sideboard,
      out: filterGuideSection(guide.sideboard.out, allowedMain),
      in: filterGuideSection(guide.sideboard.in, allowedSide)
    },
    battlefields: {
      ...guide.battlefields,
      game1: filterGuideSection(guide.battlefields.game1, allowedBattlefields),
      game1First: filterGuideSection(guide.battlefields.game1First, allowedBattlefields),
      game1Second: filterGuideSection(guide.battlefields.game1Second, allowedBattlefields)
    }
  };
}

function filterGuideSection(section: DeckGuideSection, allowed: Set<string>): DeckGuideSection {
  return {
    ...section,
    cards: section.cards.filter((card) => allowed.has(card.cardKey))
  };
}

function normalizeWatchItem(item: DeckCardWatchItem): DeckCardWatchItem | null {
  const status = item.status === "Overperforming" || item.status === "Underperforming" || item.status === "Cut candidate"
    ? item.status
    : "Testing";
  const cardName = text(item.cardName);
  const cardKey = text(item.cardKey) || cardKeyFor(cardName, item.cardId);
  if (!cardName || !cardKey) {
    return null;
  }
  return {
    id: text(item.id) || makeStableId("watch", cardKey),
    cardKey,
    cardName,
    cardId: text(item.cardId),
    imageUrl: text(item.imageUrl),
    status,
    note: text(item.note),
    createdAt: text(item.createdAt) || new Date().toISOString(),
    ...(item.updatedAt ? { updatedAt: text(item.updatedAt) } : {})
  };
}

function entryQty(entry: { qty?: number }): number {
  const qty = Number(entry.qty ?? 1);
  return Number.isFinite(qty) ? Math.max(1, Math.trunc(qty)) : 1;
}

function cardKeyFor(name: string, cardId: unknown): string {
  const id = text(cardId);
  return id ? normalizedText(id) : normalizedText(name);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function makeStableId(prefix: string, value: unknown): string {
  return `${prefix}-${hashString(String(value || Date.now()))}`;
}

function normalizedKey(value: string | undefined): string {
  return normalizedText(value ?? "");
}

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function dateMs(value: string): number {
  const date = new Date(value);
  return date.getTime();
}
