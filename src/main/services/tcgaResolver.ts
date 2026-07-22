import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { readFile } from "node:fs/promises";
import {
  riftboundCardCodeAliases,
  riftboundCardCodeFromValue,
  riftboundCanonicalArtCode
} from "../../shared/cardIdentity.js";
import { legendFromImageUrl } from "../../shared/legendImages.js";
import {
  CANONICAL_LEGEND_NAMES,
  canonicalLegendName,
  normalizeLegendName
} from "../../shared/legendNames.js";

interface LegacyLookupPayload {
  hashMap?: Record<string, string>;
  codeMap?: Record<string, string>;
}

interface RegistryCardPayload {
  printId?: unknown;
  basePrintId?: unknown;
  code?: unknown;
  publicCode?: unknown;
  name?: unknown;
  displayName?: unknown;
  type?: unknown;
  supertype?: unknown;
  champion?: unknown;
  tags?: unknown;
  imageUrl?: unknown;
  imageHash?: unknown;
  imageHashAliases?: unknown;
  hashes?: unknown;
  codeAliases?: unknown;
}

interface RegistryPayload extends LegacyLookupPayload {
  cards?: unknown;
  entries?: unknown;
  specialBattlefields?: unknown;
}

type RegistryCardKind = "legend" | "battlefield" | "rune" | "other";

interface RegistryCard {
  code: string;
  baseCode: string;
  name: string;
  kind: RegistryCardKind;
  champion: string;
  legendProxy: boolean;
  hashes: string[];
  aliases: string[];
}

interface RegistryMatch {
  matched: boolean;
  card?: RegistryCard;
}

const HASH_RE = /(?:^|[^a-f0-9])([a-f0-9]{40})(?=$|[^a-f0-9])/i;
const REGISTRY_FILENAME = "riftbound_card_registry.json";
const LEGACY_LOOKUP_FILENAME = "tcga_card_lookup.json";

/**
 * Resolves the card identities captured from TCGA and Atlas without making a
 * runtime network request. New builds use the typed card registry, while the
 * legacy hash/code lookup remains a compatibility fallback for older installs.
 */
export class TcgaResolver {
  private loading: Promise<void> | null = null;
  private legacyHashMap: Record<string, string> = {};
  private legacyCodeMap: Record<string, string> = {};
  private registryExactCodeMap = new Map<string, RegistryCard>();
  private registryAliasCodeMap = new Map<string, RegistryCard>();
  private registryHashMap = new Map<string, RegistryCard>();
  private ambiguousExactCodes = new Set<string>();
  private ambiguousAliasCodes = new Set<string>();
  private ambiguousHashes = new Set<string>();

  constructor(
    private readonly lookupPath: string,
    private readonly registryPath?: string
  ) {}

  async resolve(value: unknown): Promise<string> {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return "";
    }
    await this.ensureLoaded();

    const match = this.findRegistryCard(raw);
    if (match.matched) {
      return match.card?.name || match.card?.champion || "";
    }
    return this.resolveLegacy(raw);
  }

  async resolveLegend(value: unknown): Promise<string> {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return "";
    }
    await this.ensureLoaded();

    const match = this.findRegistryCard(raw);
    if (match.matched) {
      return match.card ? legendIdentityFor(match.card) : "";
    }

    const legacy = this.resolveLegacy(raw) || legendFromImageUrl(raw);
    return normalizeLegendName(legacy);
  }

  async resolveBattlefield(value: unknown): Promise<string> {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return "";
    }
    await this.ensureLoaded();

    const match = this.findRegistryCard(raw);
    if (match.matched) {
      return match.card?.kind === "battlefield" ? match.card.name : "";
    }
    return this.resolveLegacy(raw);
  }

  async resolveCard(value: unknown): Promise<string> {
    return await this.resolve(value);
  }

  private findRegistryCard(value: string): RegistryMatch {
    const decoded = decodeLoose(value);
    const hash = decoded.match(HASH_RE)?.[1]?.toLowerCase() ?? "";
    if (hash) {
      if (this.ambiguousHashes.has(hash)) {
        return { matched: true };
      }
      const card = this.registryHashMap.get(hash);
      if (card) {
        return { matched: true, card };
      }
    }

    const aliases = riftboundCardCodeAliases(decoded);
    for (const [index, code] of aliases.entries()) {
      if (this.ambiguousExactCodes.has(code)) {
        return { matched: true };
      }
      const card = this.registryExactCodeMap.get(code);
      if (card) {
        return { matched: true, card };
      }
      // The exact spelling should always win. Only use derived aliases after
      // checking the exact registry index for that spelling.
      if (index > 0 || aliases.length === 1) {
        if (this.ambiguousAliasCodes.has(code)) {
          return { matched: true };
        }
        const aliasCard = this.registryAliasCodeMap.get(code);
        if (aliasCard) {
          return { matched: true, card: aliasCard };
        }
      }
    }

    const canonicalRuneCode = canonicalRuneArtCode(decoded);
    if (canonicalRuneCode && !aliases.includes(canonicalRuneCode)) {
      if (this.ambiguousExactCodes.has(canonicalRuneCode)) {
        return { matched: true };
      }
      const canonicalCard = this.registryExactCodeMap.get(canonicalRuneCode);
      if (canonicalCard) {
        // The numbered OGN card is the stable artwork/identity fallback for
        // set-specific Rune prints. Never let that fallback reinterpret an
        // unrelated numbered card that happens to occupy the same code.
        return canonicalCard.kind === "rune"
          ? { matched: true, card: canonicalCard }
          : { matched: true };
      }
    }
    return { matched: false };
  }

  private resolveLegacy(value: string): string {
    const decoded = decodeLoose(value);
    const hash = decoded.match(HASH_RE)?.[1]?.toLowerCase() ?? "";
    if (hash && this.legacyHashMap[hash]) {
      return this.legacyHashMap[hash];
    }
    const aliases = riftboundCardCodeAliases(decoded);
    for (const code of aliases) {
      if (this.legacyCodeMap[code]) {
        return this.legacyCodeMap[code];
      }
    }
    const canonicalRuneCode = canonicalRuneArtCode(decoded);
    if (canonicalRuneCode && !aliases.includes(canonicalRuneCode) && this.legacyCodeMap[canonicalRuneCode]) {
      return this.legacyCodeMap[canonicalRuneCode];
    }
    return "";
  }

  private async ensureLoaded(): Promise<void> {
    this.loading ??= this.loadResources();
    await this.loading;
  }

  private async loadResources(): Promise<void> {
    const candidates = resourceCandidates(this.lookupPath, this.registryPath);
    for (const path of candidates) {
      try {
        const raw = await readFile(path, "utf8");
        this.ingestPayload(JSON.parse(raw) as RegistryPayload);
      } catch {
        // A registry is optional so already-installed builds keep using the
        // packaged legacy lookup. Invalid optional data must not stop capture.
      }
    }
  }

  private ingestPayload(payload: RegistryPayload): void {
    this.legacyHashMap = {
      ...this.legacyHashMap,
      ...normalizeLegacyMap(payload.hashMap, "lower")
    };
    this.legacyCodeMap = {
      ...this.legacyCodeMap,
      ...normalizeLegacyCodeMap(payload.codeMap)
    };

    const rawCards = Array.isArray(payload.cards)
      ? payload.cards
      : Array.isArray(payload.entries)
        ? payload.entries
        : [];
    for (const rawCard of rawCards) {
      const card = normalizeRegistryCard(rawCard);
      if (card) {
        this.addRegistryCard(card);
      }
    }

    if (Array.isArray(payload.specialBattlefields)) {
      for (const rawCard of payload.specialBattlefields) {
        const card = normalizeRegistryCard(rawCard, "battlefield");
        if (card) {
          this.addRegistryCard(card);
        }
      }
    }
  }

  private addRegistryCard(card: RegistryCard): void {
    addUnambiguous(this.registryExactCodeMap, this.ambiguousExactCodes, card.code, card);
    for (const code of [...new Set([card.baseCode, ...card.aliases].filter((code) => code && code !== card.code))]) {
      addUnambiguous(this.registryAliasCodeMap, this.ambiguousAliasCodes, code, card);
    }
    for (const hash of card.hashes) {
      addUnambiguous(this.registryHashMap, this.ambiguousHashes, hash, card);
    }
  }
}

function resourceCandidates(lookupPath: string, explicitRegistryPath?: string): string[] {
  const primary = resolvePath(lookupPath);
  const directory = dirname(primary);
  const inferredSibling = basename(primary).toLowerCase() === REGISTRY_FILENAME
    ? join(directory, LEGACY_LOOKUP_FILENAME)
    : join(directory, REGISTRY_FILENAME);
  return [...new Set([
    primary,
    explicitRegistryPath ? resolvePath(explicitRegistryPath) : inferredSibling
  ])];
}

function normalizeRegistryCard(value: unknown, forcedKind?: RegistryCardKind): RegistryCard | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const raw = value as RegistryCardPayload;
  const code = firstCardCode(raw.printId, raw.code, raw.publicCode);
  if (!code) {
    return undefined;
  }
  const baseCode = firstCardCode(raw.basePrintId) || riftboundCardCodeAliases(code).at(-1) || code;
  const name = firstString(raw.name, raw.displayName);
  const kind = forcedKind ?? registryCardKind(raw.type, raw.supertype);
  const champion = firstString(raw.champion) || championFromTags(raw.tags);
  if (!name && !champion) {
    return undefined;
  }
  const hashes = stringValues(raw.imageHash, raw.imageHashAliases, raw.hashes)
    .flatMap((candidate) => candidate.match(HASH_RE)?.[1]?.toLowerCase() ?? [])
    .concat(firstString(raw.imageUrl).match(HASH_RE)?.[1]?.toLowerCase() ?? [])
    .filter(Boolean);
  const aliases = stringValues(raw.codeAliases)
    .map((candidate) => riftboundCardCodeFromValue(candidate))
    .filter(Boolean);
  return {
    code,
    baseCode,
    name: name || champion,
    kind,
    champion,
    legendProxy: kind === "legend" || (
      normalizeClassification(raw.type) === "unit"
      && normalizeClassification(raw.supertype) === "champion"
      && Boolean(exactCanonicalLegendName(champion))
    ),
    hashes: [...new Set(hashes)],
    aliases: [...new Set(aliases)]
  };
}

function registryCardKind(type: unknown, supertype: unknown): RegistryCardKind {
  const keys = [type, supertype]
    .map(normalizeClassification)
    .filter(Boolean);
  if (keys.some((key) => key.includes("battlefield"))) {
    return "battlefield";
  }
  if (keys.some((key) => key === "legend" || key.endsWith("legend"))) {
    return "legend";
  }
  if (keys.some((key) => key === "rune" || key.endsWith("rune"))) {
    return "rune";
  }
  return "other";
}

function canonicalRuneArtCode(value: string): string {
  const code = riftboundCardCodeFromValue(value);
  if (!/^[A-Z]{2,5}-R\d{1,3}[A-Z]?\*?$/.test(code)) {
    return "";
  }
  return riftboundCanonicalArtCode(code);
}

function normalizedLegendFor(card: RegistryCard): string {
  const fromName = canonicalLegendName(card.name);
  if (fromName) {
    return fromName;
  }
  return canonicalLegendName(card.champion) || normalizeLegendName(card.champion);
}

function legendIdentityFor(card: RegistryCard): string {
  if (card.kind === "legend") {
    return normalizedLegendFor(card);
  }
  // TCGA sometimes renders a champion Unit's alternate art in its Legend
  // slot (for example UNL-089A for Jhin). Accept that narrow case only when
  // the unit points to an already-known gameplay Legend identity.
  return card.legendProxy ? exactCanonicalLegendName(card.champion) : "";
}

function championFromTags(value: unknown): string {
  for (const tag of stringValues(value)) {
    const canonical = exactCanonicalLegendName(tag);
    if (canonical) {
      return canonical;
    }
  }
  return "";
}

function exactCanonicalLegendName(value: unknown): string {
  const key = normalizeIdentity(String(value ?? ""));
  return CANONICAL_LEGEND_NAMES.find((legend) => normalizeIdentity(legend) === key) ?? "";
}

function normalizeClassification(value: unknown): string {
  return String(value ?? "").replace(/[^a-z]/gi, "").toLowerCase();
}

function addUnambiguous(
  map: Map<string, RegistryCard>,
  ambiguous: Set<string>,
  key: string,
  card: RegistryCard
): void {
  if (!key || ambiguous.has(key)) {
    return;
  }
  const existing = map.get(key);
  if (!existing) {
    map.set(key, card);
    return;
  }
  if (sameResolvedIdentity(existing, card)) {
    return;
  }
  map.delete(key);
  ambiguous.add(key);
}

function sameResolvedIdentity(left: RegistryCard, right: RegistryCard): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "legend") {
    return normalizedLegendFor(left) === normalizedLegendFor(right);
  }
  return normalizeIdentity(left.name) === normalizeIdentity(right.name);
}

function normalizeLegacyMap(
  source: Record<string, string> | undefined,
  mode: "lower" | "upper"
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(source)) {
    return out;
  }
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    const nextKey = mode === "lower" ? key.toLowerCase() : key.toUpperCase();
    out[nextKey] = value.trim();
  }
  return out;
}

function normalizeLegacyCodeMap(source: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(source)) {
    return out;
  }
  for (const [key, value] of Object.entries(source)) {
    const code = riftboundCardCodeFromValue(key);
    if (code && typeof value === "string" && value.trim()) {
      out[code] = value.trim();
    }
  }
  return out;
}

function firstCardCode(...values: unknown[]): string {
  for (const value of values) {
    const code = riftboundCardCodeFromValue(String(value ?? ""));
    if (code) {
      return code;
    }
  }
  return "";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function stringValues(...values: unknown[]): string[] {
  return values.flatMap((value) => {
    if (typeof value === "string") {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
    return [];
  });
}

function normalizeIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeLoose(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
