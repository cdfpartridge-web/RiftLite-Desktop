import { createHash } from "node:crypto";
import { normalizeLegendName } from "../../shared/legendNames.js";
import type { DeckEntry, MatchDraft, SavedDeck, UserSettings } from "../../shared/types.js";
import { RiftLiteStore } from "./store.js";

const PILTOVER_URL_RE = /^https?:\/\/(?:www\.)?piltoverarchive\.com\/decks\/view\/([0-9a-fA-F-]{36})(?:[/?#].*)?$/;
const SECTION_HEADERS = ["Legend", "Runes", "Battlefields", "Main Deck", "Sideboard", "Deck Guide", "Match History", "Version History"];
const QUANTITY_LINE_RE = /^(?:x|X|\u00d7)\s*(\d+)$/;
const SAME_LINE_QUANTITY_RE = /^(?:x|X|\u00d7)?\s*(\d+)\s+(.+)$/;
const COUNT_OR_TOTAL_RE = /^(?:\d+\s*\/\s*\d+|\d+|\/\s*\d+)$/;
const ENERGY_RE = /^\d+\s+energy$/i;
const COLOR_WORDS = new Set(["Order", "Mind", "Chaos", "Fury", "Calm", "Spirit", "Body", "Death", "Nature", "Light", "Darkness"]);
const SECTION_ALIASES: Record<string, string[]> = {
  legend: ["legend", "legends", "champion", "champions"],
  runes: ["runes", "runeDeck", "rune_deck"],
  battlefields: ["battlefields", "battlefield"],
  mainDeck: ["mainDeck", "main_deck", "main", "cards", "deck"],
  sideboard: ["sideboard", "side_board"]
};

export class DeckService {
  constructor(private readonly store: RiftLiteStore) {}

  getDecks(): Promise<SavedDeck[]> {
    return this.store.getSavedDecks();
  }

  async importDeck(url: string): Promise<SavedDeck> {
    const payload = await this.fetchPiltoverDeck(url);
    return this.store.upsertSavedDeck({
      sourceUrl: payload.sourceUrl,
      sourceKey: payload.sourceKey,
      title: payload.title,
      legend: payload.legend,
      snapshotJson: JSON.stringify(payload.snapshot),
      lastRefreshStatus: "ok",
      lastRefreshError: ""
    });
  }

  async refreshDeck(id: string): Promise<SavedDeck> {
    const existing = await this.store.getSavedDeck(id);
    if (!existing) {
      throw new Error("Deck not found.");
    }
    if (!existing.sourceUrl.startsWith("http")) {
      return this.store.upsertSavedDeck({ ...existing, lastRefreshStatus: "local", lastRefreshError: "" });
    }
    try {
      const refreshed = await this.importDeck(existing.sourceUrl);
      return refreshed;
    } catch (error) {
      return this.store.upsertSavedDeck({
        ...existing,
        lastRefreshStatus: "failed",
        lastRefreshError: error instanceof Error ? error.message : "Refresh failed."
      });
    }
  }

  async deleteDeck(id: string): Promise<void> {
    await this.store.deleteSavedDeck(id);
  }

  async setActiveDeck(id: string): Promise<UserSettings> {
    if (id && !await this.store.getSavedDeck(id)) {
      throw new Error("Deck not found.");
    }
    return this.store.saveSettings({ activeDeckId: id });
  }

  async attachBestDeck(draft: MatchDraft, snapshot: Record<string, unknown>, settings: UserSettings): Promise<MatchDraft> {
    if (draft.deckSnapshotJson) {
      return draft;
    }
    const selectedDeck = snapshot.selectedDeck && typeof snapshot.selectedDeck === "object"
      ? snapshot.selectedDeck as Record<string, unknown>
      : {};
    const tcgaDeck = draft.platform === "tcga" ? await this.resolveTcgaSelectedDeck(selectedDeck) : null;
    if (tcgaDeck && isDeckCompatible(tcgaDeck, draft.myChampion)) {
      return applyDeckToDraft(draft, tcgaDeck);
    }
    if (settings.activeDeckId) {
      const active = await this.store.getSavedDeck(settings.activeDeckId);
      if (active && isDeckCompatible(active, draft.myChampion)) {
        return applyDeckToDraft(draft, active);
      }
    }
    return draft;
  }

  private async resolveTcgaSelectedDeck(selectedDeck: Record<string, unknown>): Promise<SavedDeck | null> {
    const snapshot = buildTcgaSnapshot(selectedDeck);
    if (!snapshot) {
      return null;
    }
    const sourceKey = readString(snapshot.source_key);
    const existing = sourceKey ? await this.store.getSavedDeckBySourceKey(sourceKey) : null;
    if (existing) {
      return existing;
    }
    const targetFingerprint = snapshotFingerprint(snapshot);
    for (const deck of await this.store.getSavedDecks()) {
      if (snapshotFingerprint(parseJsonRecord(deck.snapshotJson)) === targetFingerprint) {
        return deck;
      }
    }
    return this.store.upsertSavedDeck({
      sourceUrl: readString(snapshot.source_url),
      sourceKey,
      title: readString(snapshot.title) || "TCGA Deck",
      legend: readString(snapshot.legend),
      snapshotJson: JSON.stringify(snapshot),
      lastRefreshStatus: "tcga-auto",
      lastRefreshError: ""
    });
  }

  private async fetchPiltoverDeck(url: string): Promise<{
    sourceUrl: string;
    sourceKey: string;
    title: string;
    legend: string;
    snapshot: Record<string, unknown>;
  }> {
    const cleanUrl = url.trim();
    const match = cleanUrl.match(PILTOVER_URL_RE);
    if (!match) {
      throw new Error("Enter a public Piltover deck link from piltoverarchive.com/decks/view/...");
    }
    const response = await fetch(cleanUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) RiftLite/0.6",
        "Accept": "text/html,application/xhtml+xml"
      }
    });
    if (response.status === 403 || response.status === 404) {
      throw new Error("That Piltover deck is private or unavailable.");
    }
    if (!response.ok) {
      throw new Error(`Could not fetch deck page (${response.status}).`);
    }
    return parsePiltoverDeckHtml(await response.text(), cleanUrl, match[1].toLowerCase());
  }
}

export function applyDeckToDraft(draft: MatchDraft, deck: SavedDeck): MatchDraft {
  return {
    ...draft,
    deckName: deck.title,
    deckSourceId: deck.sourceKey || deck.id,
    deckSourceKey: deck.sourceKey,
    deckSourceUrl: deck.sourceUrl,
    deckSnapshotJson: deck.snapshotJson
  };
}

function parsePiltoverDeckHtml(html: string, sourceUrl: string, sourceKey: string): {
  sourceUrl: string;
  sourceKey: string;
  title: string;
  legend: string;
  snapshot: Record<string, unknown>;
} {
  const lines = visibleLines(html);
  if (lines.includes("Private Deck") || lines.includes("Deck Unavailable")) {
    throw new Error("That Piltover deck is private or unavailable.");
  }
  const title = extractTitle(html) || lines.find((line) => !SECTION_HEADERS.includes(line) && !line.includes(" - ") && line.length > 3) || "";
  const imageMap = extractImageMap(html);
  const legend = parseSingleName(findSection(lines, "Legend"));
  const runes = parseQuantitySection(findSection(lines, "Runes"), imageMap);
  const battlefields = parseQuantitySection(findSection(lines, "Battlefields"), imageMap);
  const mainDeck = parseQuantitySection(findSection(lines, "Main Deck"), imageMap);
  const sideboard = parseQuantitySection(findSection(lines, "Sideboard"), imageMap);
  if (!title || !legend || !mainDeck.length) {
    throw new Error("Could not parse that Piltover deck page.");
  }
  const snapshot = buildSnapshot({
    title,
    legend,
    sourceUrl,
    sourceKey,
    legendEntry: buildEntry(legend, 1, imageMap),
    runes,
    battlefields,
    mainDeck,
    sideboard
  });
  return { sourceUrl, sourceKey, title, legend, snapshot };
}

function buildTcgaSnapshot(selectedDeck: Record<string, unknown>): Record<string, unknown> | null {
  const deckList = selectedDeck.deckList && typeof selectedDeck.deckList === "object"
    ? selectedDeck.deckList as Record<string, unknown>
    : {};
  const selectedUuid = readString(selectedDeck.selected_uuid || selectedDeck.id || selectedDeck.deck_uuid || selectedDeck.uuid);
  const title = readString(selectedDeck.title || selectedDeck.name || selectedDeck.selected_label) || "TCGA Deck";
  const legendEntries = coerceSectionEntries(sectionValue(deckList, "legend"), "legend");
  if (!legendEntries.length) {
    return null;
  }
  const legend = readString(legendEntries[0].name);
  const runes = coerceSectionEntries(sectionValue(deckList, "runes"), "runes");
  const battlefields = coerceSectionEntries(sectionValue(deckList, "battlefields"), "battlefields");
  const mainDeck = coerceSectionEntries(sectionValue(deckList, "mainDeck"), "mainDeck");
  const sideboard = coerceSectionEntries(sectionValue(deckList, "sideboard"), "sideboard");
  const baseSnapshot = buildSnapshot({
    title,
    legend,
    sourceUrl: selectedUuid ? `tcga://deck/${selectedUuid}` : "",
    sourceKey: selectedUuid ? `tcga:${selectedUuid}` : "",
    legendEntry: legendEntries[0],
    runes,
    battlefields,
    mainDeck,
    sideboard,
    tcgaMeta: {
      selected_uuid: selectedUuid,
      format: selectedDeck.format,
      cardCount: selectedDeck.cardCount,
      lastModifiedAt: selectedDeck.lastModifiedAt
    }
  });
  if (!baseSnapshot.source_key) {
    baseSnapshot.source_key = `tcga:${sha1(snapshotFingerprint(baseSnapshot))}`;
    baseSnapshot.sourceKey = baseSnapshot.source_key;
  }
  return baseSnapshot;
}

function buildSnapshot(input: {
  title: string;
  legend: string;
  sourceUrl: string;
  sourceKey: string;
  legendEntry?: DeckEntry;
  runes: DeckEntry[];
  battlefields: DeckEntry[];
  mainDeck: DeckEntry[];
  sideboard: DeckEntry[];
  tcgaMeta?: Record<string, unknown>;
}): Record<string, unknown> {
  const legendKey = normalizeLegendName(input.legend);
  return {
    title: input.title,
    legend: input.legend,
    legend_key: legendKey,
    legendKey,
    legend_entry: input.legendEntry,
    legendEntry: input.legendEntry,
    source_url: input.sourceUrl,
    sourceUrl: input.sourceUrl,
    source_key: input.sourceKey,
    sourceKey: input.sourceKey,
    runes: input.runes,
    battlefields: input.battlefields,
    main_deck: input.mainDeck,
    mainDeck: input.mainDeck,
    sideboard: input.sideboard,
    tcga_meta: input.tcgaMeta,
    tcgaMeta: input.tcgaMeta
  };
}

function isDeckCompatible(deck: SavedDeck, matchLegend: string): boolean {
  const snapshot = parseJsonRecord(deck.snapshotJson);
  const deckLegend = normalizeLegendName(readString(snapshot.legend) || readString(snapshot.legend_key) || deck.legend);
  const target = normalizeLegendName(matchLegend);
  return Boolean(deckLegend && target && deckLegend === target);
}

function snapshotFingerprint(snapshot: Record<string, unknown>): string {
  const block = (label: string, rawEntries: unknown): string => {
    const entries = Array.isArray(rawEntries) ? rawEntries : rawEntries && typeof rawEntries === "object" ? [rawEntries] : [];
    const values = entries.map((entry) => {
      const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      const name = label === "legend"
        ? normalizeLegendName(record.name)
        : readString(record.name);
      const qty = Number(record.qty ?? 1) || 1;
      return name ? `${qty}x${normalizeLookupKey(name)}` : "";
    }).filter(Boolean).sort();
    return `${label}:${values.join("|")}`;
  };
  return [
    block("legend", snapshot.legend_entry || { name: snapshot.legend, qty: 1 }),
    block("runes", snapshot.runes),
    block("battlefields", snapshot.battlefields),
    block("main", snapshot.main_deck || snapshot.mainDeck),
    block("side", snapshot.sideboard)
  ].join("||");
}

function visibleLines(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|h1|h2|h3|section|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n/)
    .map((line) => htmlUnescape(line).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractTitle(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = h1 || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return stripHtml(title).replace(/\s+-\s+Piltover Archive$/i, "").trim();
}

function extractImageMap(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  const imagePattern = /<img\b([^>]+)>/gi;
  let match: RegExpExecArray | null;
  while ((match = imagePattern.exec(html))) {
    const attrs = attributes(match[1] ?? "");
    const alt = readString(attrs.alt);
    if (!alt || /^(piltover archive|logo)$/i.test(alt)) {
      continue;
    }
    const srcset = readString(attrs.srcset);
    const src = bestSrc(srcset) || readString(attrs.src);
    if (!src) {
      continue;
    }
    result[alt] = absolutizePiltoverUrl(src);
  }
  return result;
}

function findSection(lines: string[], header: string): string[] {
  const start = lines.findIndex((line) => line.toLowerCase() === header.toLowerCase());
  if (start < 0) {
    return [];
  }
  const result: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (SECTION_HEADERS.some((candidate) => candidate.toLowerCase() === line.toLowerCase())) {
      break;
    }
    if (!isNoiseLine(line)) {
      result.push(line);
    }
  }
  return result;
}

function parseSingleName(lines: string[]): string {
  return lines.find((line) => !isNoiseLine(line)) ?? "";
}

function parseQuantitySection(lines: string[], imageMap: Record<string, string>): DeckEntry[] {
  const entries: DeckEntry[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = cleanItemName(lines[index] ?? "");
    const sameLine = line.match(SAME_LINE_QUANTITY_RE);
    if (sameLine && !isNoiseLine(sameLine[2] ?? "")) {
      entries.push(buildEntry(sameLine[2] ?? "", Number(sameLine[1]), imageMap));
      continue;
    }
    const quantityMatch = line.match(QUANTITY_LINE_RE);
    if (!quantityMatch) {
      continue;
    }
    const qty = Number(quantityMatch[1]);
    for (let lookahead = index + 1; lookahead < lines.length; lookahead += 1) {
      const candidate = cleanItemName(lines[lookahead] ?? "");
      if (QUANTITY_LINE_RE.test(candidate)) {
        break;
      }
      if (!isNoiseLine(candidate)) {
        entries.push(buildEntry(candidate, qty, imageMap));
        index = lookahead;
        break;
      }
    }
  }
  return entries.filter((entry) => entry.name && !isNoiseLine(entry.name));
}

function coerceSectionEntries(value: unknown, section: string): DeckEntry[] {
  const rawEntries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>).map(([name, qty]) => ({ name, qty }))
      : typeof value === "string"
        ? [value]
        : [];
  return rawEntries.map((entry) => {
    const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const name = typeof entry === "string"
      ? entry
      : readString(record.name || record.cardName || record.title || record.displayName || record.card_name);
    const qty = Number(record.qty ?? record.count ?? record.quantity ?? record.copies ?? record.amount ?? 1) || 1;
    const cleanName = section === "legend" ? normalizeLegendName(name) || name : name;
    return {
      qty: Math.max(1, Math.trunc(qty)),
      name: cleanItemName(cleanName),
      cardId: readString(record.card_id || record.cardId || record.id),
      card_id: readString(record.card_id || record.cardId || record.id),
      imageUrl: readString(record.image_url || record.imageUrl),
      image_url: readString(record.image_url || record.imageUrl),
      costEnergy: Number(record.cost_energy ?? record.costEnergy ?? 0) || 0,
      cost_energy: Number(record.cost_energy ?? record.costEnergy ?? 0) || 0,
      costPower: Number(record.cost_power ?? record.costPower ?? 0) || 0,
      cost_power: Number(record.cost_power ?? record.costPower ?? 0) || 0
    } as DeckEntry;
  }).filter((entry) => entry.name);
}

function sectionValue(deckList: Record<string, unknown>, section: string): unknown {
  const aliases = SECTION_ALIASES[section] ?? [section];
  for (const [key, value] of Object.entries(deckList)) {
    if (aliases.some((alias) => normalizeLookupKey(alias) === normalizeLookupKey(key))) {
      return value;
    }
  }
  return undefined;
}

function buildEntry(name: string, qty: number, imageMap: Record<string, string>): DeckEntry {
  const cleanName = cleanItemName(name);
  const imageUrl = resolveImageUrl(cleanName, imageMap);
  const cardId = imageUrl.match(/\/cards\/([^/?#.]+)/i)?.[1]?.toUpperCase() ?? "";
  return {
    qty: Math.max(1, Math.trunc(qty || 1)),
    name: cleanName,
    cardId,
    card_id: cardId,
    imageUrl,
    image_url: imageUrl
  } as DeckEntry;
}

function isNoiseLine(line: string): boolean {
  const value = cleanItemName(line);
  return !value ||
    COUNT_OR_TOTAL_RE.test(value) ||
    ENERGY_RE.test(value) ||
    COLOR_WORDS.has(value) ||
    /^(cards?|copy|copies|legal|loading|vs|link|code|builder|chosen champion)$/i.test(value);
}

function cleanItemName(name: string): string {
  return htmlUnescape(name).replace(/\s+Chosen Champion$/i, "").replace(/\s+/g, " ").trim();
}

function resolveImageUrl(name: string, imageMap: Record<string, string>): string {
  const direct = Object.entries(imageMap).find(([candidate]) => cleanItemName(candidate).toLowerCase() === name.toLowerCase());
  if (direct) {
    return direct[1];
  }
  const target = normalizeLookupKey(name);
  return Object.entries(imageMap).find(([candidate]) => normalizeLookupKey(candidate) === target)?.[1] ?? "";
}

function attributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([a-z0-9:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw))) {
    result[(match[1] ?? "").toLowerCase()] = htmlUnescape(match[3] ?? match[4] ?? match[5] ?? "");
  }
  return result;
}

function bestSrc(srcset: string): string {
  if (!srcset) {
    return "";
  }
  return srcset.split(",").map((part) => part.trim().split(/\s+/)[0] ?? "").filter(Boolean).pop() ?? "";
}

function absolutizePiltoverUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://piltoverarchive.com${url}`;
  return url;
}

function stripHtml(value: string): string {
  return htmlUnescape(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function htmlUnescape(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeLookupKey(value: unknown): string {
  return readString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readString(value: unknown): string {
  return String(value ?? "").trim();
}

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}
