import { normalizeLegendName } from "./legendNames.js";
import type { CommunityMatch, DeckEntry, DeckSnapshot, MatchGame } from "./types.js";

export type CommunityDeckCardSection = "legend" | "champions" | "runes" | "mainDeck" | "sideboard" | "battlefields";

export interface CommunityDeckRecordStats {
  total: number;
  wins: number;
  losses: number;
  draws: number;
  incomplete: number;
  decisive: number;
  record: string;
  winRate: number;
  winRateLabel: string;
}

export interface CommunityDeckCardStat extends CommunityDeckRecordStats {
  key: string;
  name: string;
  cardId: string;
  imageUrl: string;
  section: CommunityDeckCardSection;
  deckCount: number;
  inclusionRate: number;
  inclusionLabel: string;
  averageCopies: number;
  commonCopies: number;
  commonCopiesRate: number;
  copyDistribution: Array<{ copies: number; decks: number; rate: number }>;
  deckKeys: string[];
  matches: CommunityMatch[];
}

export interface CommunityDeckBattlefieldStat extends CommunityDeckCardStat {
  chosenMatches: number;
  chosenRate: number;
  chosenRateLabel: string;
  firstChosenMatches: number;
  secondChosenMatches: number;
  firstChosenRate: number;
  secondChosenRate: number;
}

export interface CommunityDeckGroup extends CommunityDeckRecordStats {
  key: string;
  title: string;
  legend: string;
  sourceUrl: string;
  sourceKey: string;
  snapshotJson: string;
  snapshot: DeckSnapshot | null;
  representativeMatchId: string;
  matchIds: string[];
  matches: CommunityMatch[];
  bo1: number;
  bo3: number;
}

export interface CommunityDeckLegendSummary extends CommunityDeckRecordStats {
  legend: string;
  deckCount: number;
  matchCount: number;
  bo1: number;
  bo3: number;
  topCard?: CommunityDeckCardStat;
  topBattlefield?: CommunityDeckBattlefieldStat;
}

export interface CommunityDeckMeta {
  groups: CommunityDeckGroup[];
  legends: CommunityDeckLegendSummary[];
  totalDecks: number;
  totalMatches: number;
  snapshotDecks: number;
}

type ParsedDeckMatch = {
  match: CommunityMatch;
  snapshot: DeckSnapshot | null;
  groupKey: string;
  title: string;
  legend: string;
  sourceKey: string;
  sourceUrl: string;
};

type CardAccumulator = {
  key: string;
  name: string;
  cardId: string;
  imageUrl: string;
  section: CommunityDeckCardSection;
  deckKeys: Set<string>;
  matchesById: Map<string, CommunityMatch>;
  copyCounts: number[];
};

type CardImageLookup = Map<string, { cardId: string; imageUrl: string }>;

type CollapsedDeckEntry = {
  key: string;
  name: string;
  cardId: string;
  imageUrl: string;
  qty: number;
};

const KNOWN_CARD_IDS_BY_NAME: Record<string, string> = {
  [normalizeKey("Acceptable Losses")]: "OGN-179",
  [normalizeKey("Angler Beast")]: "UNL-132",
  [normalizeKey("Baron Nashor")]: "UNL-147",
  [normalizeKey("Diana, No Longer Human")]: "UNL-149",
  [normalizeKey("Dr. Mundo, Expert")]: "OGN-109",
  [normalizeKey("Fizz, Trickster")]: "SFD-140",
  [normalizeKey("Invert Timelines")]: "OGN-201",
  [normalizeKey("Last Rites")]: "SFD-150",
  [normalizeKey("Moonfall")]: "UNL-198",
  [normalizeKey("Rhasa the Sunderer")]: "OGN-195",
  [normalizeKey("Singularity")]: "OGN-105",
  [normalizeKey("Sneaky Deckhand")]: "OGN-176",
  [normalizeKey("Switcheroo")]: "SFD-145",
  [normalizeKey("The Syren")]: "OGN-184",
  [normalizeKey("Thousand-Tailed Watcher")]: "OGN-116",
  [normalizeKey("Zaun Warrens")]: "OGN-298"
};

export function buildCommunityDeckMeta(matches: CommunityMatch[]): CommunityDeckMeta {
  const publicRows = matches.filter(isPublicCommunityDeckMatch);
  const parsed = publicRows.map(parseCommunityDeckMatch).filter((item): item is ParsedDeckMatch => Boolean(item));
  const groupsByKey = new Map<string, ParsedDeckMatch[]>();
  for (const item of parsed) {
    const rows = groupsByKey.get(item.groupKey) ?? [];
    rows.push(item);
    groupsByKey.set(item.groupKey, rows);
  }

  const groups = [...groupsByKey.entries()]
    .map(([key, rows]) => buildDeckGroup(key, rows))
    .sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));

  const legends = buildLegendSummaries(groups);
  return {
    groups,
    legends,
    totalDecks: groups.length,
    totalMatches: publicRows.length,
    snapshotDecks: groups.filter((group) => group.snapshot).length
  };
}

export function communityDeckGroupsForLegend(groups: CommunityDeckGroup[] | CommunityDeckMeta, legend: string): CommunityDeckGroup[] {
  const rows = Array.isArray(groups) ? groups : groups.groups;
  const legendKey = normalizeLegendName(legend);
  return rows.filter((group) => normalizeLegendName(group.legend) === legendKey);
}

export function communityCardStatsForLegend(
  groups: CommunityDeckGroup[] | CommunityDeckMeta,
  legend: string,
  section: CommunityDeckCardSection = "mainDeck"
): CommunityDeckCardStat[] {
  const allGroups = Array.isArray(groups) ? groups : groups.groups;
  const legendGroups = communityDeckGroupsForLegend(groups, legend).filter((group) => group.snapshot);
  return buildCardStats(legendGroups, section, buildCardImageLookup(allGroups));
}

export function communityBattlefieldStatsForLegend(
  groups: CommunityDeckGroup[] | CommunityDeckMeta,
  legend: string
): CommunityDeckBattlefieldStat[] {
  const allGroups = Array.isArray(groups) ? groups : groups.groups;
  const legendGroups = communityDeckGroupsForLegend(groups, legend).filter((group) => group.snapshot);
  const cardStats = buildCardStats(legendGroups, "battlefields", buildCardImageLookup(allGroups));
  return cardStats.map((stat) => {
    let chosenMatches = 0;
    let firstChosenMatches = 0;
    let secondChosenMatches = 0;
    let checkedSlots = 0;
    for (const group of legendGroups) {
      if (!stat.deckKeys.includes(group.key)) {
        continue;
      }
      for (const match of group.matches) {
        const games = parseCommunityGames(match.gamesJson);
        const slots = games.length ? games : [{
          gameNumber: 1,
          result: normalizeResult(match.result),
          myBattlefield: match.myBattlefield,
          oppBattlefield: match.opponentBattlefield,
          wentFirst: match.wentFirst
        }];
        for (const game of slots) {
          checkedSlots += 1;
          if (sameCardName(game.myBattlefield, stat.name)) {
            chosenMatches += 1;
            if (normalizeSeat(game.wentFirst) === "1st") {
              firstChosenMatches += 1;
            }
            if (normalizeSeat(game.wentFirst) === "2nd") {
              secondChosenMatches += 1;
            }
          }
        }
      }
    }
    const chosenRate = checkedSlots ? Math.round((chosenMatches / checkedSlots) * 1000) / 10 : 0;
    return {
      ...stat,
      chosenMatches,
      chosenRate,
      chosenRateLabel: `${formatPercent(chosenRate)} chosen`,
      firstChosenMatches,
      secondChosenMatches,
      firstChosenRate: checkedSlots ? Math.round((firstChosenMatches / checkedSlots) * 1000) / 10 : 0,
      secondChosenRate: checkedSlots ? Math.round((secondChosenMatches / checkedSlots) * 1000) / 10 : 0
    };
  }).sort((a, b) => b.inclusionRate - a.inclusionRate || b.chosenRate - a.chosenRate || a.name.localeCompare(b.name));
}

export function parseCommunityDeckSnapshot(snapshotJson: string): DeckSnapshot | null {
  if (!snapshotJson.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(snapshotJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const value = parsed as Record<string, unknown>;
    const title = readString(value.title, value.name, value.deckName, value.deck_name);
    const legend = normalizeLegendName(readString(value.legend, value.legendName, value.legend_name, value.champion));
    const sourceUrl = readString(value.sourceUrl, value.source_url);
    const sourceKey = readString(value.sourceKey, value.source_key);
    return {
      title,
      legend,
      legendKey: readString(value.legendKey, value.legend_key) || normalizeKey(legend),
      legendEntry: readDeckEntry(value.legendEntry ?? value.legend_entry),
      sourceUrl,
      sourceKey,
      runes: readDeckEntries(value.runes),
      battlefields: readDeckEntries(value.battlefields),
      mainDeck: readDeckEntries(value.mainDeck ?? value.main_deck),
      sideboard: readDeckEntries(value.sideboard),
      tcgaMeta: typeof value.tcgaMeta === "object" && value.tcgaMeta && !Array.isArray(value.tcgaMeta)
        ? value.tcgaMeta as Record<string, unknown>
        : undefined
    };
  } catch {
    return null;
  }
}

function isPublicCommunityDeckMatch(match: CommunityMatch): boolean {
  if (match.scope !== "community") {
    return false;
  }
  const hasSnapshot = Boolean(match.deckSnapshotJson?.trim());
  const hasSource = Boolean(match.deckSourceKey?.trim() || match.deckSourceUrl?.trim());
  const hasName = meaningfulDeckName(match.deckName);
  return hasSnapshot || hasSource || hasName;
}

function parseCommunityDeckMatch(match: CommunityMatch): ParsedDeckMatch | null {
  const parsedSnapshot = parseCommunityDeckSnapshot(match.deckSnapshotJson);
  const legend = normalizeLegendName(parsedSnapshot?.legend || match.myChampion);
  if (!legend) {
    return null;
  }
  const snapshot = parsedSnapshot
    ? {
      ...parsedSnapshot,
      legend: normalizeLegendName(parsedSnapshot.legend || legend),
      legendKey: parsedSnapshot.legendKey || normalizeKey(legend)
    }
    : null;
  const title = readString(snapshot?.title, match.deckName) || `${legend} deck`;
  const sourceKey = readString(match.deckSourceKey, snapshot?.sourceKey);
  const sourceUrl = readString(match.deckSourceUrl, snapshot?.sourceUrl);
  const groupKey = sourceKey
    ? `source:${normalizeKey(sourceKey)}`
    : snapshot
      ? `snapshot:${hashStableValue(snapshotFingerprint(snapshot))}`
      : `name:${normalizeKey(`${legend}|${title}|${match.deckSourceUrl}`)}`;
  return {
    match,
    snapshot,
    groupKey,
    title,
    legend,
    sourceKey,
    sourceUrl
  };
}

function buildDeckGroup(key: string, rows: ParsedDeckMatch[]): CommunityDeckGroup {
  const matches = rows.map((row) => row.match).sort((a, b) => matchTime(b) - matchTime(a));
  const representative = rows.find((row) => row.snapshot) ?? rows[0];
  const stats = recordStats(matches);
  return {
    ...stats,
    key,
    title: representative.title,
    legend: representative.legend,
    sourceUrl: representative.sourceUrl,
    sourceKey: representative.sourceKey,
    snapshotJson: representative.snapshot ? representative.match.deckSnapshotJson : "",
    snapshot: representative.snapshot,
    representativeMatchId: representative.match.id,
    matchIds: matches.map((match) => match.id),
    matches,
    bo1: matches.filter((match) => match.format === "Bo1").length,
    bo3: matches.filter((match) => match.format === "Bo3").length
  };
}

function buildLegendSummaries(groups: CommunityDeckGroup[]): CommunityDeckLegendSummary[] {
  const imageLookup = buildCardImageLookup(groups);
  const byLegend = new Map<string, CommunityDeckGroup[]>();
  for (const group of groups) {
    const legend = normalizeLegendName(group.legend) || "Unknown";
    const rows = byLegend.get(legend) ?? [];
    rows.push(group);
    byLegend.set(legend, rows);
  }
  return [...byLegend.entries()]
    .map(([legend, legendGroups]) => {
      const matches = uniqueMatches(legendGroups.flatMap((group) => group.matches));
      const stats = recordStats(matches);
      const topCard = buildCardStats(legendGroups, "mainDeck", imageLookup)[0];
      const topBattlefield = communityBattlefieldStatsForLegend(legendGroups, legend)[0];
      return {
        ...stats,
        legend,
        deckCount: legendGroups.length,
        matchCount: matches.length,
        bo1: matches.filter((match) => match.format === "Bo1").length,
        bo3: matches.filter((match) => match.format === "Bo3").length,
        topCard,
        topBattlefield
      };
    })
    .sort((a, b) => b.deckCount - a.deckCount || b.matchCount - a.matchCount || a.legend.localeCompare(b.legend));
}

function buildCardStats(
  groups: CommunityDeckGroup[],
  section: CommunityDeckCardSection,
  imageLookup: CardImageLookup = buildCardImageLookup(groups)
): CommunityDeckCardStat[] {
  const accumulators = new Map<string, CardAccumulator>();
  let totalDecks = 0;
  for (const group of groups) {
    if (!group.snapshot) {
      continue;
    }
    const entries = collapseDeckEntries(deckEntriesForSection(group.snapshot, section), section, imageLookup);
    if (section !== "champions" || entries.length) {
      totalDecks += 1;
    }
    for (const entry of entries) {
      if (!entry.key) {
        continue;
      }
      const accumulator: CardAccumulator = accumulators.get(entry.key) ?? {
        key: entry.key,
        name: entry.name,
        cardId: entry.cardId,
        imageUrl: entry.imageUrl,
        section,
        deckKeys: new Set<string>(),
        matchesById: new Map<string, CommunityMatch>(),
        copyCounts: []
      };
      accumulator.deckKeys.add(group.key);
      accumulator.copyCounts.push(entry.qty);
      for (const match of group.matches) {
        accumulator.matchesById.set(match.id, match);
      }
      if (!accumulator.imageUrl && entry.imageUrl) {
        accumulator.imageUrl = entry.imageUrl;
      }
      if (!accumulator.cardId && entry.cardId) {
        accumulator.cardId = entry.cardId;
      }
      accumulators.set(entry.key, accumulator);
    }
  }
  return [...accumulators.values()]
    .map((item) => {
      const matches = [...item.matchesById.values()];
      const distribution = copyDistribution(item.copyCounts);
      const common = distribution[0];
      const deckCount = item.deckKeys.size;
      const inclusionRate = totalDecks ? Math.round((deckCount / totalDecks) * 1000) / 10 : 0;
      const averageCopies = item.copyCounts.length
        ? Math.round((item.copyCounts.reduce((sum, value) => sum + value, 0) / item.copyCounts.length) * 10) / 10
        : 0;
      return {
        ...recordStats(matches),
        key: item.key,
        name: item.name,
        cardId: item.cardId,
        imageUrl: item.imageUrl,
        section: item.section,
        deckCount,
        inclusionRate,
        inclusionLabel: `${formatPercent(inclusionRate)} of decks`,
        averageCopies,
        commonCopies: common?.copies ?? 0,
        commonCopiesRate: common?.rate ?? 0,
        copyDistribution: distribution,
        deckKeys: [...item.deckKeys],
        matches
      };
    })
    .sort((a, b) => b.inclusionRate - a.inclusionRate || b.deckCount - a.deckCount || a.name.localeCompare(b.name));
}

function deckEntriesForSection(snapshot: DeckSnapshot, section: CommunityDeckCardSection): DeckEntry[] {
  if (section === "legend") {
    return snapshot.legendEntry ? [snapshot.legendEntry] : [];
  }
  if (section === "champions") {
    const championChoices = snapshot.mainDeck.filter((entry) => isChampionCardForDeck(entry, snapshot.legend, snapshot.legendEntry?.name));
    return championChoices.length ? [championChoices[0]] : [];
  }
  if (section === "runes") {
    return snapshot.runes;
  }
  if (section === "sideboard") {
    return snapshot.sideboard;
  }
  if (section === "battlefields") {
    return snapshot.battlefields.filter(isBattlefieldEntry);
  }
  return snapshot.mainDeck;
}

function recordStats(matches: CommunityMatch[]): CommunityDeckRecordStats {
  const completed = matches.filter((match) => normalizeResult(match.result) !== "Incomplete");
  const wins = completed.filter((match) => normalizeResult(match.result) === "Win").length;
  const losses = completed.filter((match) => normalizeResult(match.result) === "Loss").length;
  const draws = completed.filter((match) => normalizeResult(match.result) === "Draw").length;
  const incomplete = matches.length - completed.length;
  const decisive = wins + losses;
  const winRate = decisive ? Math.round((wins / decisive) * 1000) / 10 : 0;
  return {
    total: completed.length,
    wins,
    losses,
    draws,
    incomplete,
    decisive,
    record: `${wins}-${losses}${draws ? `-${draws}` : ""}`,
    winRate,
    winRateLabel: decisive ? `${formatPercent(winRate)} WR` : "No WR"
  };
}

function parseCommunityGames(gamesJson: string): MatchGame[] {
  if (!gamesJson?.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(gamesJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((value, index) => readCommunityGame(value, index))
      .filter((game): game is MatchGame => Boolean(game));
  } catch {
    return [];
  }
}

function readCommunityGame(value: unknown, index: number): MatchGame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const game = value as Record<string, unknown>;
  return {
    gameNumber: readNumber(game.gameNumber, game.game_number, game.number) ?? index + 1,
    result: normalizeResult(readString(game.result, game.outcome)),
    myPoints: readNumber(game.myPoints, game.my_points, game.myScore, game.my_score, game.me, game.my),
    oppPoints: readNumber(
      game.oppPoints,
      game.opp_points,
      game.oppScore,
      game.opp_score,
      game.opponentPoints,
      game.opponent_points,
      game.opponentScore,
      game.opponent_score,
      game.opp,
      game.opponent
    ),
    myBattlefield: readString(game.myBattlefield, game.myBf, game.my_bf, game.my_battlefield, game.playerBattlefield, game.player_battlefield),
    oppBattlefield: readString(
      game.oppBattlefield,
      game.opponentBattlefield,
      game.oppBf,
      game.opp_bf,
      game.opponent_battlefield,
      game.enemyBattlefield,
      game.enemy_battlefield
    ),
    wentFirst: normalizeSeat(readString(game.wentFirst, game.went_first, game.seat))
  };
}

function readDeckEntries(value: unknown): DeckEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(readDeckEntry)
    .filter((entry): entry is DeckEntry => Boolean(entry?.name));
}

function readDeckEntry(value: unknown): DeckEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entry = value as Record<string, unknown>;
  const name = readString(entry.name, entry.cardName, entry.card_name, entry.title);
  if (!name) {
    return undefined;
  }
  const cardId = readString(entry.cardId, entry.card_id, entry.id, entry.code) || knownCardIdFromName(name);
  const imageUrl = readString(entry.imageUrl, entry.image_url, entry.image, entry.src) || cardImageUrlFromId(cardId);
  return {
    qty: normalizeCopies(readNumber(entry.qty, entry.quantity, entry.count) ?? 1),
    name,
    cardId,
    imageUrl,
    costEnergy: readNumber(entry.costEnergy, entry.cost_energy),
    costPower: readNumber(entry.costPower, entry.cost_power)
  };
}

function snapshotFingerprint(snapshot: DeckSnapshot): Record<string, unknown> {
  return {
    title: snapshot.title,
    legend: snapshot.legend,
    mainDeck: snapshot.mainDeck.map(entryFingerprint),
    sideboard: snapshot.sideboard.map(entryFingerprint),
    battlefields: snapshot.battlefields.map(entryFingerprint),
    runes: runeFingerprints(snapshot.runes)
  };
}

function entryFingerprint(entry: DeckEntry): Record<string, unknown> {
  return {
    qty: entry.qty,
    name: cardDisplayName(entry, "mainDeck")
  };
}

function runeFingerprints(entries: DeckEntry[]): Array<Record<string, unknown>> {
  const runes = new Map<string, { name: string; qty: number }>();
  for (const entry of entries) {
    const name = canonicalRuneName(entry.name);
    const key = normalizeKey(name);
    if (!key) {
      continue;
    }
    const existing = runes.get(key) ?? { name, qty: 0 };
    existing.qty += normalizeCopies(entry.qty);
    runes.set(key, existing);
  }
  return [...runes.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      qty: entry.qty,
      name: entry.name
    }));
}

function copyDistribution(values: number[]): Array<{ copies: number; decks: number; rate: number }> {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([copies, decks]) => ({
      copies,
      decks,
      rate: values.length ? Math.round((decks / values.length) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.decks - a.decks || b.copies - a.copies);
}

function uniqueMatches(matches: CommunityMatch[]): CommunityMatch[] {
  const seen = new Map<string, CommunityMatch>();
  for (const match of matches) {
    seen.set(match.id, match);
  }
  return [...seen.values()];
}

function collapseDeckEntries(
  entries: DeckEntry[],
  section: CommunityDeckCardSection,
  imageLookup: CardImageLookup = new Map()
): CollapsedDeckEntry[] {
  const collapsed = new Map<string, CollapsedDeckEntry>();
  for (const entry of entries) {
    const key = cardStatKey(entry, section);
    if (!key) {
      continue;
    }
    const image = bestImageForEntry(entry, section, imageLookup);
    const existing = collapsed.get(key);
    if (existing) {
      existing.qty += normalizeCopies(entry.qty);
      if (!existing.imageUrl && image.imageUrl) {
        existing.imageUrl = image.imageUrl;
      }
      if (!existing.cardId && image.cardId) {
        existing.cardId = image.cardId;
      }
      continue;
    }
    collapsed.set(key, {
      key,
      name: cardDisplayName(entry, section),
      cardId: image.cardId,
      imageUrl: image.imageUrl,
      qty: normalizeCopies(entry.qty)
    });
  }
  return [...collapsed.values()];
}

function buildCardImageLookup(groups: CommunityDeckGroup[]): CardImageLookup {
  const lookup: CardImageLookup = new Map();
  for (const group of groups) {
    const snapshot = group.snapshot;
    if (!snapshot) {
      continue;
    }
    const sections: Array<[CommunityDeckCardSection, DeckEntry[]]> = [
      ["legend", snapshot.legendEntry ? [snapshot.legendEntry] : []],
      ["runes", snapshot.runes],
      ["battlefields", snapshot.battlefields],
      ["mainDeck", snapshot.mainDeck],
      ["sideboard", snapshot.sideboard]
    ];
    for (const [section, entries] of sections) {
      for (const entry of entries) {
        rememberCardImage(lookup, entry, section);
      }
    }
  }
  return lookup;
}

function rememberCardImage(lookup: CardImageLookup, entry: DeckEntry, section: CommunityDeckCardSection): void {
  const image = bestImageForEntry(entry, section);
  if (!image.imageUrl && !image.cardId) {
    return;
  }
  const keys = new Set([
    cardStatKey(entry, section),
    `name:${normalizeKey(entry.name)}`,
    `name:${normalizeKey(cardDisplayName(entry, section))}`
  ]);
  for (const key of keys) {
    if (!key || lookup.has(key)) {
      continue;
    }
    lookup.set(key, image);
  }
}

function bestImageForEntry(entry: DeckEntry, section: CommunityDeckCardSection, imageLookup?: CardImageLookup): { cardId: string; imageUrl: string } {
  const directCardId = entry.cardId || knownCardIdFromName(entry.name);
  const lookup =
    imageLookup?.get(cardStatKey(entry, section)) ??
    imageLookup?.get(`name:${normalizeKey(entry.name)}`) ??
    imageLookup?.get(`name:${normalizeKey(cardDisplayName(entry, section))}`);
  const cardId = directCardId || lookup?.cardId || "";
  const imageUrl = entry.imageUrl || cardImageUrlFromId(cardId) || lookup?.imageUrl || "";
  return { cardId, imageUrl };
}

function cardStatKey(entry: DeckEntry, section: CommunityDeckCardSection): string {
  if (section === "runes") {
    const rune = normalizeKey(canonicalRuneName(entry.name));
    return rune ? `rune:${rune}` : "";
  }
  const name = normalizeKey(entry.name);
  if (name) {
    return `name:${name}`;
  }
  const id = normalizeKey(entry.cardId ?? "");
  return id ? `id:${id}` : "";
}

function cardDisplayName(entry: DeckEntry, section: CommunityDeckCardSection): string {
  return section === "runes" ? canonicalRuneName(entry.name) : entry.name;
}

function isBattlefieldEntry(entry: DeckEntry): boolean {
  return !isRuneEntry(entry);
}

function isRuneEntry(entry: DeckEntry): boolean {
  return /\brune\b/i.test(entry.name);
}

function isChampionCardForDeck(entry: DeckEntry, deckLegend: string, leaderName = ""): boolean {
  const character = cardCharacterName(entry.name);
  if (!character || normalizeLegendName(character) !== normalizeLegendName(deckLegend)) {
    return false;
  }
  return normalizeKey(entry.name) !== normalizeKey(leaderName);
}

function cardCharacterName(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.+?)\s*(?:,|\s+-\s+|\s+–\s+|\s+—\s+)/);
  return match?.[1]?.trim() ?? "";
}

function canonicalRuneName(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/\b([a-z]+)\s+rune\b/i);
  if (!match) {
    return cleaned;
  }
  return `${capitalizeWord(match[1])} Rune`;
}

function capitalizeWord(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}` : value;
}

function cardImageUrlFromId(cardId: string): string {
  const trimmed = cardId.trim();
  const normalized = trimmed.replace(/^([a-z]{2,4})-/i, (_match, set: string) => `${set.toUpperCase()}-`);
  return /^[A-Z]{2,4}-\d{3}[a-z]?$/i.test(trimmed)
    ? `https://cdn.piltoverarchive.com/cards/${normalized}.webp`
    : "";
}

function knownCardIdFromName(name: string): string {
  return KNOWN_CARD_IDS_BY_NAME[normalizeKey(name)] ?? "";
}

function normalizeResult(value: unknown): MatchGame["result"] {
  const text = readString(value).toLowerCase();
  if (text === "win" || text === "wins") {
    return "Win";
  }
  if (text === "loss" || text === "lose" || text === "lost") {
    return "Loss";
  }
  if (text === "draw" || text === "tie") {
    return "Draw";
  }
  return "Incomplete";
}

function normalizeSeat(value: unknown): MatchGame["wentFirst"] {
  const text = readString(value).toLowerCase();
  if (text === "1st" || text.includes("went 1") || text.includes("first")) {
    return "1st";
  }
  if (text === "2nd" || text.includes("went 2") || text.includes("second")) {
    return "2nd";
  }
  if (text.includes("undecided")) {
    return "undecided";
  }
  return "";
}

function sameCardName(left: unknown, right: unknown): boolean {
  return normalizeKey(readString(left)) === normalizeKey(readString(right));
}

function meaningfulDeckName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "riftbound" && normalized !== "deck pending" && normalized !== "no deck logged";
}

function normalizeCopies(value: unknown): number {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 1;
}

function readString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function readNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hashStableValue(value: unknown): string {
  const text = stableStringify(value);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function matchTime(match: CommunityMatch): number {
  const date = new Date(match.date || match.createdAt * 1000).getTime();
  return Number.isFinite(date) ? date : 0;
}

function formatPercent(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}
