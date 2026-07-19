const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_PAGES_PER_SET = 500;

export const REGISTRY_SCHEMA_VERSION = 1;

const PRINT_ID_RE = /^([A-Z0-9]{2,5})-([A-Z]{0,3})(\d{1,4})([A-Z]?)(\*?)(?:-(\d{1,4}))?$/;
const VARIANT_LABEL_RE = /\s*\((?:alternate art|overnumbered|signature)\)\s*$/i;
const RIOT_IMAGE_HASH_RE = /\/([a-f0-9]{40})-\d+x\d+\.(?:avif|jpe?g|png|webp)(?:\?|$)/i;

/**
 * Normalize a RiftCodex/Riftbound print identifier without throwing away the
 * part that distinguishes an alternate-art or signed print.
 *
 * Examples:
 * - `unl-226*-219` -> `UNL-226*`
 * - `ogn-089a-298` -> `OGN-089A`
 * - `ven-r01` -> `VEN-R01`
 * - `sfd-t03` -> `SFD-T03`
 * - `ven-sp1-006` -> `VEN-SP1`
 */
export function normalizePrintId(value, expectedSetCode = "") {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Card is missing a Riftbound print id");
  }

  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  const match = PRINT_ID_RE.exec(compact);
  if (!match) {
    throw new Error(`Unsupported Riftbound print id: ${value}`);
  }

  const [, setCode, collectorPrefix, rawDigits, variantSuffix, signatureMarker, rawSetSize] = match;
  const expected = String(expectedSetCode || "").trim().toUpperCase();
  if (expected && setCode !== expected) {
    throw new Error(`Print id ${value} belongs to ${setCode}, expected ${expected}`);
  }

  const collectorDigits = normalizeCollectorDigits(collectorPrefix, rawDigits);
  const collectorCode = `${collectorPrefix}${collectorDigits}${variantSuffix}${signatureMarker}`;
  const baseCollectorCode = `${collectorPrefix}${collectorDigits}`;
  const numericCollectorNumber = collectorPrefix ? null : Number.parseInt(collectorDigits, 10);
  const printedSetSize = rawSetSize ? Number.parseInt(rawSetSize, 10) : null;

  return {
    printId: `${setCode}-${collectorCode}`,
    basePrintId: `${setCode}-${baseCollectorCode}`,
    setCode,
    collectorCode,
    collectorPrefix,
    collectorNumber: Number.parseInt(collectorDigits, 10),
    numericCollectorNumber,
    printedSetSize,
    alternateArtSuffix: variantSuffix || null,
    signature: signatureMarker === "*",
  };
}

function normalizeCollectorDigits(prefix, digits) {
  const numeric = Number.parseInt(digits, 10);
  if (!Number.isFinite(numeric)) return digits;
  if (!prefix) return String(numeric).padStart(3, "0");
  if (prefix === "R" || prefix === "T") return String(numeric).padStart(2, "0");
  if (prefix === "SP") return String(numeric);
  return digits;
}

export function extractRiotImageHash(imageUrl) {
  if (typeof imageUrl !== "string") return null;
  return RIOT_IMAGE_HASH_RE.exec(imageUrl)?.[1]?.toLowerCase() || null;
}

export function normalizeSourceCard(rawCard, expectedSetCode = "") {
  if (!rawCard || typeof rawCard !== "object" || Array.isArray(rawCard)) {
    throw new Error("RiftCodex returned a non-object card record");
  }

  const setCode = readString(rawCard.set?.set_id || expectedSetCode).toUpperCase();
  const parsed = normalizePrintId(readString(rawCard.riftbound_id), setCode);
  const type = readRequiredString(rawCard.classification?.type, `${parsed.printId} type`);
  const supertype = readNullableString(rawCard.classification?.supertype);
  const rawName = readRequiredString(rawCard.name, `${parsed.printId} name`);
  const imageUrl = readRequiredHttpUrl(rawCard.media?.image_url, `${parsed.printId} image_url`);
  const tags = uniqueStrings(rawCard.tags);
  const carriesChampionIdentity = type.toLowerCase() === "legend" || supertype?.toLowerCase() === "champion";
  const champion = carriesChampionIdentity ? inferChampion(rawName, tags) : null;
  const name = normalizeCardName(rawName, carriesChampionIdentity, champion);
  const updatedAt = normalizeOptionalIsoDate(rawCard.metadata?.updated_on, parsed.printId);

  const metadataAlternateArt = rawCard.metadata?.alternate_art === true;
  const metadataSignature = rawCard.metadata?.signature === true;
  if (metadataAlternateArt && !parsed.alternateArtSuffix) {
    throw new Error(`${parsed.printId} is marked alternate art but its print id has no art suffix`);
  }
  if (metadataSignature && !parsed.signature) {
    throw new Error(`${parsed.printId} is marked signed but its print id has no * marker`);
  }

  const derivedOvernumbered = parsed.numericCollectorNumber !== null
    && parsed.printedSetSize !== null
    && parsed.numericCollectorNumber > parsed.printedSetSize;

  const sourceId = readString(rawCard.id);
  const strippedSourceName = stripVariantLabel(rawName);
  const aliases = uniqueStrings([
    strippedSourceName,
    strippedSourceName.replace(/\s+-\s+/g, ", "),
  ]).filter((alias) => alias.toLocaleLowerCase() !== name.toLocaleLowerCase());

  return {
    printId: parsed.printId,
    basePrintId: parsed.basePrintId,
    setCode: parsed.setCode,
    collectorCode: parsed.collectorCode,
    name,
    type,
    supertype,
    tags,
    champion,
    imageUrl,
    imageHash: extractRiotImageHash(imageUrl),
    artist: readNullableString(rawCard.media?.artist),
    updatedAt,
    variants: {
      alternateArt: Boolean(parsed.alternateArtSuffix || metadataAlternateArt),
      overnumbered: Boolean(
        rawCard.metadata?.overnumbered === true
        || (derivedOvernumbered && !parsed.signature && !metadataSignature)
      ),
      signature: Boolean(parsed.signature || metadataSignature),
    },
    aliases,
    sourceIds: sourceId ? [sourceId] : [],
  };
}

function inferChampion(rawName, tags) {
  if (!tags.length) return null;
  if (tags.length === 1) return tags[0];

  const normalizedName = stripVariantLabel(rawName).toLocaleLowerCase();
  const matchingTags = tags.filter((tag) => normalizedName.includes(tag.toLocaleLowerCase()));
  return matchingTags.at(-1) || tags.at(-1) || null;
}

function normalizeCardName(rawName, carriesChampionIdentity, champion) {
  const stripped = stripVariantLabel(rawName);
  if (!carriesChampionIdentity || !champion) return stripped;

  const lowerName = stripped.toLocaleLowerCase();
  const lowerChampion = champion.toLocaleLowerCase();
  const championIndex = lowerName.lastIndexOf(lowerChampion);
  if (championIndex >= 0) {
    const afterChampion = stripped
      .slice(championIndex + champion.length)
      .replace(/^\s*(?:-|,|:)\s*/, "")
      .trim();
    if (afterChampion) return `${champion}, ${afterChampion}`;
    if (stripped.trim().toLocaleLowerCase() === lowerChampion) return champion;
  }

  return `${champion}, ${stripped}`;
}

function stripVariantLabel(value) {
  return String(value || "").replace(VARIANT_LABEL_RE, "").trim();
}

/**
 * Collapse duplicate API rows by their complete print id. A single print id
 * with different artwork is treated as a source collision and fails closed;
 * inventing an A/B suffix would make tracker matches unreliable.
 */
export function dedupeCards(cards) {
  if (!Array.isArray(cards)) throw new Error("Cards must be an array");
  const groups = new Map();
  for (const card of cards) {
    assertNormalizedCard(card);
    const group = groups.get(card.printId) || [];
    group.push(card);
    groups.set(card.printId, group);
  }

  const deduped = [];
  for (const [printId, group] of groups) {
    const imageKeys = uniqueStrings(group.map((card) => card.imageHash || stripUrlQuery(card.imageUrl)));
    if (imageKeys.length > 1) {
      throw new Error(`${printId} maps to multiple images; refusing an unsafe dedupe`);
    }

    const types = uniqueStrings(group.map((card) => card.type.toLocaleLowerCase()));
    if (types.length > 1) {
      throw new Error(`${printId} maps to multiple card types: ${types.join(", ")}`);
    }

    const selected = [...group].sort(compareCardFreshness).at(-1);
    const names = uniqueStrings(group.map((card) => card.name));
    const aliases = uniqueStrings([
      ...group.flatMap((card) => card.aliases || []),
      ...names.filter((name) => name.toLocaleLowerCase() !== selected.name.toLocaleLowerCase()),
    ]);

    deduped.push({
      ...selected,
      tags: uniqueStrings(group.flatMap((card) => card.tags || [])),
      aliases,
      sourceIds: uniqueStrings(group.flatMap((card) => card.sourceIds || [])).sort(),
      variants: {
        alternateArt: group.some((card) => card.variants.alternateArt),
        overnumbered: group.some((card) => card.variants.overnumbered),
        signature: group.some((card) => card.variants.signature),
      },
    });
  }

  return deduped.sort(comparePrintIds);
}

function compareCardFreshness(left, right) {
  const dateComparison = String(left.updatedAt || "").localeCompare(String(right.updatedAt || ""));
  if (dateComparison !== 0) return dateComparison;
  return String(left.sourceIds?.[0] || "").localeCompare(String(right.sourceIds?.[0] || ""));
}

function comparePrintIds(left, right) {
  return left.printId.localeCompare(right.printId, "en", { numeric: true });
}

export function mergeRegistryOverlay(cards, overlay = {}) {
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) {
    throw new Error("Registry overlay must be a JSON object");
  }
  if (overlay.schemaVersion !== undefined && overlay.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new Error(`Unsupported registry overlay schemaVersion: ${overlay.schemaVersion}`);
  }

  const byPrintId = new Map(cards.map((card) => [card.printId, card]));
  for (const rawOverlayCard of overlay.cards || []) {
    const overlayCard = normalizeOverlayCard(rawOverlayCard);
    const existing = byPrintId.get(overlayCard.printId);
    if (!existing) {
      byPrintId.set(overlayCard.printId, overlayCard);
      continue;
    }

    const merged = {
      ...existing,
      ...withoutUndefined(overlayCard),
      printId: existing.printId,
      basePrintId: overlayCard.basePrintId || existing.basePrintId,
      setCode: existing.setCode,
      collectorCode: existing.collectorCode,
      variants: { ...existing.variants, ...withoutUndefined(overlayCard.variants) },
      tags: uniqueStrings([...(existing.tags || []), ...(overlayCard.tags || [])]),
      aliases: uniqueStrings([...(existing.aliases || []), ...(overlayCard.aliases || [])]),
      sourceIds: uniqueStrings([...(existing.sourceIds || []), ...(overlayCard.sourceIds || [])]),
    };
    assertNormalizedCard(merged);
    byPrintId.set(merged.printId, merged);
  }

  const specialBattlefields = normalizeSpecialBattlefields(overlay.specialBattlefields || []);
  return {
    cards: [...byPrintId.values()].sort(comparePrintIds),
    specialBattlefields,
  };
}

function normalizeOverlayCard(rawCard) {
  if (!rawCard || typeof rawCard !== "object" || Array.isArray(rawCard)) {
    throw new Error("Overlay cards must be JSON objects");
  }
  const parsed = normalizePrintId(readString(rawCard.printId));
  const type = readRequiredString(rawCard.type, `${parsed.printId} overlay type`);
  const name = readRequiredString(rawCard.name, `${parsed.printId} overlay name`);
  const variants = rawCard.variants || {};
  const imageUrl = readNullableString(rawCard.imageUrl);
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
    throw new Error(`${parsed.printId} overlay imageUrl must be HTTP(S)`);
  }

  return {
    printId: parsed.printId,
    basePrintId: parsed.basePrintId,
    setCode: parsed.setCode,
    collectorCode: parsed.collectorCode,
    name,
    type,
    supertype: readNullableString(rawCard.supertype),
    tags: uniqueStrings(rawCard.tags),
    champion: readNullableString(rawCard.champion),
    imageUrl,
    imageHash: readNullableString(rawCard.imageHash) || extractRiotImageHash(imageUrl),
    artist: readNullableString(rawCard.artist),
    updatedAt: normalizeOptionalIsoDate(rawCard.updatedAt, parsed.printId),
    variants: {
      alternateArt: variants.alternateArt ?? Boolean(parsed.alternateArtSuffix),
      overnumbered: variants.overnumbered ?? false,
      signature: variants.signature ?? parsed.signature,
    },
    aliases: uniqueStrings(rawCard.aliases),
    sourceIds: uniqueStrings(rawCard.sourceIds || [`local-overlay:${parsed.printId}`]),
  };
}

function normalizeSpecialBattlefields(entries) {
  if (!Array.isArray(entries)) throw new Error("specialBattlefields must be an array");
  const seen = new Set();
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Special battlefield entries must be JSON objects");
    }
    const name = readRequiredString(entry.name, "special battlefield name");
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate special battlefield: ${name}`);
    seen.add(key);
    return {
      name,
      aliases: uniqueStrings(entry.aliases),
      isActive: entry.isActive !== false,
      imageName: readString(entry.imageName) || name,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export function validateRegistry(cards, expectations = {}, specialBattlefields = []) {
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error("Generated registry contains no cards");
  }

  const errors = [];
  const byPrintId = new Map();
  const hashNames = new Map();
  for (const card of cards) {
    try {
      assertNormalizedCard(card);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (byPrintId.has(card.printId)) errors.push(`Duplicate print id: ${card.printId}`);
    byPrintId.set(card.printId, card);

    if (card.imageHash) {
      const priorName = hashNames.get(card.imageHash);
      if (priorName && priorName.toLocaleLowerCase() !== card.name.toLocaleLowerCase()) {
        errors.push(`Image hash ${card.imageHash} maps to both ${priorName} and ${card.name}`);
      } else {
        hashNames.set(card.imageHash, card.name);
      }
    }
  }

  if (expectations.schemaVersion !== undefined && expectations.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    errors.push(`Unsupported expectations schemaVersion: ${expectations.schemaVersion}`);
  }

  for (const requiredId of expectations.requiredPrintIds || []) {
    try {
      const normalized = normalizePrintId(requiredId).printId;
      if (!byPrintId.has(normalized)) errors.push(`Missing required print id: ${normalized}`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const sets = expectations.sets || {};
  for (const [rawSetCode, setExpectation] of Object.entries(sets)) {
    const setCode = rawSetCode.toUpperCase();
    const setCards = cards.filter((card) => card.setCode === setCode);
    const minimum = Number(setExpectation.minUniquePrints || 0);
    if (setCards.length < minimum) {
      errors.push(`${setCode} has ${setCards.length} unique prints; expected at least ${minimum}`);
    }

    for (const requiredId of setExpectation.requiredPrintIds || []) {
      try {
        const normalized = normalizePrintId(requiredId, setCode).printId;
        if (!byPrintId.has(normalized)) errors.push(`Missing required ${setCode} print id: ${normalized}`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    for (const [type, rawMinimum] of Object.entries(setExpectation.minTypeCounts || {})) {
      const typeCount = setCards.filter((card) => card.type.toLocaleLowerCase() === type.toLocaleLowerCase()).length;
      const typeMinimum = Number(rawMinimum || 0);
      if (typeCount < typeMinimum) {
        errors.push(`${setCode} has ${typeCount} ${type} cards; expected at least ${typeMinimum}`);
      }
    }

    for (const [variant, rawMinimum] of Object.entries(setExpectation.minVariantCounts || {})) {
      if (!["alternateArt", "overnumbered", "signature"].includes(variant)) {
        errors.push(`${setCode} has an unsupported variant expectation: ${variant}`);
        continue;
      }
      const variantCount = setCards.filter((card) => card.variants[variant] === true).length;
      const variantMinimum = Number(rawMinimum || 0);
      if (variantCount < variantMinimum) {
        errors.push(`${setCode} has ${variantCount} ${variant} prints; expected at least ${variantMinimum}`);
      }
    }
  }

  const specialNames = new Set(specialBattlefields.map((item) => item.name.toLocaleLowerCase()));
  for (const requiredName of expectations.requiredSpecialBattlefields || []) {
    if (!specialNames.has(String(requiredName).toLocaleLowerCase())) {
      errors.push(`Missing required special battlefield: ${requiredName}`);
    }
  }

  if (errors.length) {
    throw new Error(`Registry validation failed:\n- ${errors.join("\n- ")}`);
  }

  return {
    uniquePrints: cards.length,
    uniqueImageHashes: hashNames.size,
    bySet: Object.fromEntries(
      [...new Set(cards.map((card) => card.setCode))]
        .sort()
        .map((setCode) => [setCode, cards.filter((card) => card.setCode === setCode).length]),
    ),
  };
}

function assertNormalizedCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    throw new Error("Registry contains a non-object card");
  }
  const parsed = normalizePrintId(card.printId, card.setCode);
  if (card.printId !== parsed.printId) throw new Error(`Print id is not canonical: ${card.printId}`);
  if (card.basePrintId !== parsed.basePrintId) throw new Error(`Invalid basePrintId for ${card.printId}`);
  if (card.collectorCode !== parsed.collectorCode) throw new Error(`Invalid collectorCode for ${card.printId}`);
  readRequiredString(card.name, `${card.printId} name`);
  readRequiredString(card.type, `${card.printId} type`);
  if (!card.variants || typeof card.variants !== "object") {
    throw new Error(`${card.printId} is missing variant metadata`);
  }
  for (const key of ["alternateArt", "overnumbered", "signature"]) {
    if (typeof card.variants[key] !== "boolean") {
      throw new Error(`${card.printId} variants.${key} must be boolean`);
    }
  }
}

export async function fetchPaginatedSet({
  endpoint,
  setCode,
  pageSize = DEFAULT_PAGE_SIZE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 2,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");
  const normalizedSetCode = readRequiredString(setCode, "setCode").toUpperCase();
  const collected = [];
  let expectedTotal = null;
  let expectedPages = null;

  for (let page = 1; page <= (expectedPages || 1); page += 1) {
    if (page > MAX_PAGES_PER_SET) throw new Error(`${normalizedSetCode} exceeded ${MAX_PAGES_PER_SET} pages`);
    const url = new URL(endpoint);
    url.searchParams.set("size", String(pageSize));
    url.searchParams.set("page", String(page));
    url.searchParams.set("set_id", normalizedSetCode.toLowerCase());
    url.searchParams.set("sort", "collector_number");
    url.searchParams.set("dir", "1");

    const payload = await fetchJsonWithRetry(url, { fetchImpl, timeoutMs, retries });
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.items)) {
      throw new Error(`${normalizedSetCode} page ${page} returned an invalid payload`);
    }
    const total = readNonNegativeInteger(payload.total, `${normalizedSetCode} total`);
    const pages = readPositiveInteger(payload.pages, `${normalizedSetCode} pages`);
    const responsePage = readPositiveInteger(payload.page, `${normalizedSetCode} page`);
    if (responsePage !== page) throw new Error(`${normalizedSetCode} requested page ${page}, received ${responsePage}`);
    if (expectedTotal === null) expectedTotal = total;
    if (expectedPages === null) expectedPages = pages;
    if (expectedTotal !== total || expectedPages !== pages) {
      throw new Error(`${normalizedSetCode} pagination changed while downloading`);
    }
    collected.push(...payload.items);
  }

  if (expectedTotal === null || collected.length !== expectedTotal) {
    throw new Error(`${normalizedSetCode} downloaded ${collected.length} rows, expected ${expectedTotal ?? "unknown"}`);
  }
  return collected;
}

async function fetchJsonWithRetry(url, { fetchImpl, timeoutMs, retries }) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": "RiftLite-registry-builder/1" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function buildRegistry({
  endpoint,
  setCodes,
  expectations = {},
  overlay = {},
  generatedAt = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
  pageSize = DEFAULT_PAGE_SIZE,
}) {
  const normalizedSetCodes = uniqueStrings(setCodes).map((setCode) => setCode.toUpperCase()).sort();
  if (!normalizedSetCodes.length) throw new Error("At least one set code is required");

  const rawCards = [];
  const rawBySet = {};
  for (const setCode of normalizedSetCodes) {
    const rows = await fetchPaginatedSet({ endpoint, setCode, pageSize, fetchImpl });
    rawBySet[setCode] = rows.length;
    rawCards.push(...rows.map((row) => normalizeSourceCard(row, setCode)));
  }

  const sourceCards = dedupeCards(rawCards);
  const merged = mergeRegistryOverlay(sourceCards, overlay);
  const validation = validateRegistry(merged.cards, expectations, merged.specialBattlefields);
  const overlayCardCount = Array.isArray(overlay.cards) ? overlay.cards.length : 0;

  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    generatedAt: normalizeRequiredIsoDate(generatedAt, "generatedAt"),
    source: {
      provider: "RiftCodex",
      endpoint,
      sets: normalizedSetCodes,
      pageSize,
    },
    stats: {
      rawRecords: rawCards.length,
      uniqueSourcePrints: sourceCards.length,
      uniquePrints: merged.cards.length,
      uniqueImageHashes: validation.uniqueImageHashes,
      localOverlayCards: overlayCardCount,
      bySet: Object.fromEntries(normalizedSetCodes.map((setCode) => [setCode, {
        rawRecords: rawBySet[setCode],
        uniquePrints: validation.bySet[setCode] || 0,
      }])),
    },
    cards: merged.cards,
    specialBattlefields: merged.specialBattlefields,
  };
}

function readRequiredHttpUrl(value, label) {
  const text = readRequiredString(value, label);
  if (!/^https?:\/\//i.test(text)) throw new Error(`${label} must be HTTP(S)`);
  return text;
}

function normalizeRequiredIsoDate(value, label) {
  const normalized = normalizeOptionalIsoDate(value, label);
  if (!normalized) throw new Error(`${label} must be an ISO date`);
  return normalized;
}

function normalizeOptionalIsoDate(value, label) {
  const text = readString(value);
  if (!text) return null;
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new Error(`${label} has an invalid date: ${text}`);
  return new Date(time).toISOString();
}

function readRequiredString(value, label) {
  const text = readString(value);
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableString(value) {
  return readString(value) || null;
}

function readNonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`);
  return parsed;
}

function readPositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = readString(value);
    if (!text) continue;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function stripUrlQuery(value) {
  return String(value || "").split("?", 1)[0];
}

function withoutUndefined(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, entryValue]) => entryValue !== undefined));
}
