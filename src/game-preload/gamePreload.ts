import { ipcRenderer } from "electron";
import { readTcgaLocalPlayerName, readTcgaProfileName } from "../shared/tcgaIdentity.js";
import type { BattlefieldCandidate, CaptureEvent, CaptureKind, GamePlatform } from "../shared/types.js";

const platform = (location.host.includes("riftatlas") ? "atlas" : "tcga") as GamePlatform;
const MAX_TEXT = 4000;
const INTERESTING_URL = /(match|game|live|socket|state|battle|deck|arena|atlas|api)/i;
const SCORE_KEYS = /(score|scores|point|points|counter|counters|damage|total)/i;
const SNAPSHOT_DEBOUNCE_MS = 800;
const ACTIVE_HEARTBEAT_MS = 5_000;
const IDLE_HEARTBEAT_MS = 12_000;
const DEBUG_MODE_REFRESH_MS = 10_000;
const ATLAS_INTERACTION_QUIET_MS = 900;
const DECK_TRACKER_FEATURE_ENABLED = false;
const BATTLEFIELD_NAMES = [
  { name: "Ravensbloom Conservatory", canonical: "Ravenbloom Conservatory" },
  { name: "Grove of the God-Willow", canonical: "Grove of the God-Willow" },
  { name: "Ravenbloom Conservatory", canonical: "Ravenbloom Conservatory" },
  { name: "Catacombs of the Poros", canonical: "Catacombs of the Poros" },
  { name: "The Candlelit Sanctum", canonical: "The Candlelit Sanctum" },
  { name: "The Mage Seeker Vault", canonical: "The Mage Seeker Vault" },
  { name: "The Arena's Greatest", canonical: "The Arena's Greatest" },
  { name: "Monastery of Hirana", canonical: "Monastery of Hirana" },
  { name: "Navori Fighting Pit", canonical: "Navori Fighting Pit" },
  { name: "Gardens of Becoming", canonical: "Gardens of Becoming" },
  { name: "Forge of the Fluft", canonical: "Forge of the Fluft" },
  { name: "Forgotten Monument", canonical: "Forgotten Monument" },
  { name: "Fortified Position", canonical: "Fortified Position" },
  { name: "Sigil of the Storm", canonical: "Sigil of the Storm" },
  { name: "Trifarian War Camp", canonical: "Trifarian War Camp" },
  { name: "Shadow Isles Ferry", canonical: "Shadow Isles Ferry" },
  { name: "The Dreaming Tree", canonical: "The Dreaming Tree" },
  { name: "Windswept Hillock", canonical: "Windswept Hillock" },
  { name: "Forgotten Library", canonical: "Forgotten Library" },
  { name: "Black Flame Altar", canonical: "Black Flame Altar" },
  { name: "Training Facility", canonical: "Training Facility" },
  { name: "Aspirant's Climb", canonical: "Aspirant's Climb" },
  { name: "Obelisk of Power", canonical: "Obelisk of Power" },
  { name: "Reckoner's Arena", canonical: "Reckoner's Arena" },
  { name: "Forbidding Waste", canonical: "Forbidding Waste" },
  { name: "Hall of Legends", canonical: "Hall of Legends" },
  { name: "Startipped Peak", canonical: "Startipped Peak" },
  { name: "The Grand Plaza", canonical: "The Grand Plaza" },
  { name: "Frozen Fortress", canonical: "Frozen Fortress" },
  { name: "Amateur Recital", canonical: "Amateur Recital" },
  { name: "Vaults of Helia", canonical: "Vaults of Helia" },
  { name: "Altar to Unity", canonical: "Altar to Unity" },
  { name: "Back-Alley Bar", canonical: "Back-Alley Bar" },
  { name: "Emperor's Dais", canonical: "Emperor's Dais" },
  { name: "Hall of Legend", canonical: "Hall of Legends" },
  { name: "Treasure Hoard", canonical: "Treasure Hoard" },
  { name: "Vilemaw's Lair", canonical: "Vilemaw's Lair" },
  { name: "Abandoned Hall", canonical: "Abandoned Hall" },
  { name: "Altar of Blood", canonical: "Altar of Blood" },
  { name: "Vault of Helia", canonical: "Vaults of Helia" },
  { name: "HallofLegends", canonical: "Hall of Legends" },
  { name: "Hallowed Tomb", canonical: "Hallowed Tomb" },
  { name: "Rockfall Path", canonical: "Rockfall Path" },
  { name: "Seat of Power", canonical: "Seat of Power" },
  { name: "Sunken Temple", canonical: "Sunken Temple" },
  { name: "Targon's Peak", canonical: "Targon's Peak" },
  { name: "The Academy", canonical: "The Academy" },
  { name: "The Acedemy", canonical: "The Academy" },
  { name: "Acedemy", canonical: "The Academy" },
  { name: "Academy", canonical: "The Academy" },
  { name: "Dreaming Tree", canonical: "The Dreaming Tree" },
  { name: "The Papertree", canonical: "The Papertree" },
  { name: "Veiled Temple", canonical: "Veiled Temple" },
  { name: "Ancient Henge", canonical: "Ancient Henge" },
  { name: "Dusk Rose Lab", canonical: "Dusk Rose Lab" },
  { name: "VaultsofHelia", canonical: "Vaults of Helia" },
  { name: "HallofLegend", canonical: "Hall of Legends" },
  { name: "Ornn's Forge", canonical: "Ornn's Forge" },
  { name: "Reaver's Row", canonical: "Reaver's Row" },
  { name: "Targons Peak", canonical: "Targon's Peak" },
  { name: "Zaun Warrens", canonical: "Zaun Warrens" },
  { name: "Ripper's Bay", canonical: "Ripper's Bay" },
  { name: "Frozen Vault", canonical: "Frozen Vault" },
  { name: "Bandle Tree", canonical: "Bandle Tree" },
  { name: "Marai Spire", canonical: "Marai Spire" },
  { name: "Power Nexus", canonical: "Power Nexus" },
  { name: "ZaunWarrens", canonical: "Zaun Warrens" },
  { name: "DuskRoseLab", canonical: "Dusk Rose Lab" },
  { name: "Star Spring", canonical: "Star Spring" },
  { name: "Baron Pit", canonical: "Baron Pit" },
  { name: "Minefield", canonical: "Minefield" },
  { name: "Void Gate", canonical: "Void Gate" },
  { name: "Brush", canonical: "Brush" }
];

let previousActive = false;
let endTimer: number | undefined;
let lastActiveSnapshot: Record<string, unknown> = {};
let lastSnapshotSignature = "";
let lastEndSignature = "";
let endedVisibleResultKey = "";
let snapshotTimer: number | undefined;
let eventCounter = 0;
let debugEnabled = false;
let lastDebugMutationAt = 0;
let lastSnapshotPublishedAt = 0;
let atlasInteractionQuietUntil = 0;
let atlasInteractionSettleTimer: number | undefined;
let atlasDeferredMutationSnapshot = false;

type CounterPlayer = {
  name: string;
  score: string;
  raw: string;
};

type AtlasScoreCandidate = {
  side: "me" | "opponent" | "";
  value: string;
  active: boolean;
  source: string;
  raw: string;
  classes: string;
  ariaLabel: string;
  top: number;
  left: number;
};

type AtlasPlayerCandidate = {
  name: string;
  side: "me" | "opponent" | "unknown";
  source: string;
  top: number;
  left: number;
  score: number;
};

type ReactScoreProps = {
  value: string;
  variant: string;
  active: boolean;
};

function now(): string {
  return new Date().toISOString();
}

function eventId(): string {
  eventCounter += 1;
  try {
    return `${platform}-${crypto.randomUUID()}`;
  } catch {
    return `${platform}-${Date.now()}-${eventCounter}`;
  }
}

function send(kind: CaptureKind, payload: Record<string, unknown>): void {
  const event: CaptureEvent = {
    id: eventId(),
    platform,
    kind,
    capturedAt: now(),
    url: location.href,
    payload
  };
  ipcRenderer.send("capture:event", event);
  ipcRenderer.sendToHost("capture:event", event);
}

function sendDebug(reason: string, payload: Record<string, unknown> = {}): void {
  if (!debugEnabled) {
    return;
  }
  send("debug", {
    reason,
    ...debugSnapshot(),
    ...payload
  });
}

function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function attr(element: Element | null | undefined, name: string): string {
  return element?.getAttribute(name)?.trim() ?? "";
}

function documentText(limit = MAX_TEXT): string {
  return (document.body?.textContent ?? "").slice(0, limit);
}

function imageIdentity(...selectors: string[]): string {
  for (const selector of selectors) {
    const img = document.querySelector(selector) as HTMLImageElement | null;
    const value = img?.currentSrc || img?.src || attr(img, "data-src") || attr(img, "alt");
    if (value) {
      return value;
    }
  }
  return "";
}

function firstText(...selectors: string[]): string {
  for (const selector of selectors) {
    const value = textOf(document.querySelector(selector));
    if (value) {
      return value;
    }
  }
  return "";
}

function readLocalStorageJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key) ?? "";
    return raw ? safeJson(raw) : null;
  } catch (error) {
    return { error: String(error) };
  }
}

function collectCards(selector: string, options: { limit?: number; includeText?: boolean; includeClasses?: boolean } = {}): Array<Record<string, string>> {
  const limit = options.limit ?? 40;
  const seen = new Set<Element>();
  const containers: Element[] = [];
  for (const element of Array.from(document.querySelectorAll(selector))) {
    const container = element instanceof HTMLImageElement
      ? element.closest(".game-card, [data-card-id], [data-drop-zone], [class*='card' i]") ?? element
      : element;
    if (seen.has(container)) {
      continue;
    }
    seen.add(container);
    containers.push(container);
    if (containers.length >= limit) {
      break;
    }
  }
  return containers
    .map((element) => {
      const img = element instanceof HTMLImageElement ? element : element.querySelector("img") as HTMLImageElement | null;
      const image = img?.currentSrc || img?.src || attr(img, "data-src") || attr(img, "alt");
      const classes = [
        attr(element, "class"),
        attr(element.parentElement, "class")
      ].filter(Boolean).join(" ");
      return {
        text: options.includeText ? textOf(element).slice(0, 80) : "",
        classes: options.includeClasses ? classes.slice(0, 120) : /battlefield-marker/i.test(classes) ? "battlefield-marker" : "",
        zone: attr(element, "data-drop-zone") || attr(element.closest("[data-drop-zone]"), "data-drop-zone"),
        zoneOwner: attr(element.closest("[data-zone-owner]"), "data-zone-owner"),
        cardId: attr(element, "data-card-id") || attr(img, "data-card-id"),
        code: cardCodeFromImage(image),
        image
      };
    })
    .filter((card) => card.text || card.cardId || card.image || card.zone);
}

function cardSnapshotSignature(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value
    .slice(0, 80)
    .map((card) => {
      if (!card || typeof card !== "object" || Array.isArray(card)) {
        return "";
      }
      const record = card as Record<string, unknown>;
      return [
        String(record.cardId ?? ""),
        String(record.code ?? ""),
        String(record.zone ?? ""),
        String(record.zoneOwner ?? ""),
        String(record.classes ?? "").replace(/\s+/g, " ").slice(0, 80),
        String(record.image ?? "").replace(/[?#].*$/, "")
      ].join(":");
    })
    .filter(Boolean)
    .sort()
    .join("|")
    .slice(0, 4000);
}

function safeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) {
    return value.slice(0, MAX_TEXT);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value.slice(0, MAX_TEXT);
  }
}

function readTcgaDeck(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem("decks_Riftbound") ?? "";
    const selected = document.querySelector("select") as HTMLSelectElement | null;
    const selectedUuid = selected?.value ?? "";
    const cacheSummary = summarizeDeckCache(raw, selectedUuid);
    const selectedDeck = cacheSummary.selectedDeck && typeof cacheSummary.selectedDeck === "object"
      ? cacheSummary.selectedDeck as Record<string, unknown>
      : {};
    return {
      ...selectedDeck,
      selected_uuid: selectedUuid,
      selected_label: selected?.selectedOptions?.[0]?.textContent?.trim() || String(cacheSummary.selectedTitle ?? ""),
      deck_cache: cacheSummary
    };
  } catch (error) {
    return { error: String(error) };
  }
}

function summarizeDeckCache(raw: string, selectedUuid: string): Record<string, unknown> {
  if (!raw) {
    return { deckCount: 0, selectedTitle: "" };
  }
  const parsed = safeJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { deckCount: 0, selectedTitle: "", parseState: "unavailable" };
  }
  const decks = (parsed as Record<string, unknown>).decks;
  const deckRecord = decks && typeof decks === "object" && !Array.isArray(decks) ? decks as Record<string, unknown> : {};
  const selectedDeck = selectedUuid && deckRecord[selectedUuid] && typeof deckRecord[selectedUuid] === "object"
    ? deckRecord[selectedUuid] as Record<string, unknown>
    : {};
  return {
    deckCount: Object.keys(deckRecord).length,
    selectedTitle: String(selectedDeck.title ?? "").trim(),
    selectedFormat: Array.isArray(selectedDeck.format) ? selectedDeck.format.map(String) : [],
    selectedCardCount: Number(selectedDeck.cardCount ?? 0) || 0,
    selectedDeck,
    lastUpdated: Number((parsed as Record<string, unknown>).lastUpdated ?? 0) || 0
  };
}

function readGenericCounterScore(): { me: string; opp: string; raw: string[]; source: string } {
  const counters = Array.from(document.querySelectorAll(".PLAYER-COUNTER, .player-counters-wrapper, [class*='counter' i], [class*='score' i]"))
    .filter((counter) => /player|counter|score|point/i.test(`${attr(counter, "class")} ${textOf(counter).slice(0, 80)}`));
  const raw = counters.map((counter) => textOf(counter));
  const values = counters.map((counter) => extractElementScoreValue(counter)).filter(Boolean);
  if (values.length >= 2) {
    return { me: values[0] ?? "", opp: values[1] ?? "", raw, source: "dom-counter" };
  }
  const paired = scoreFromText(raw.join(" | "));
  if (paired.me || paired.opp) {
    return { ...paired, raw, source: "dom-text" };
  }
  return { me: "", opp: "", raw, source: "none" };
}

function readTcgaCounterPlayers(): CounterPlayer[] {
  const primary = Array.from(document.querySelectorAll(".PLAYER-COUNTER"));
  const fallback = primary.length ? [] : Array.from(document.querySelectorAll(".player-counters-wrapper"))
    .flatMap((wrapper) => {
      const children = Array.from(wrapper.children).filter((child) => child.querySelector("h5.pseudo, [class*='pseudo' i], input[type='number']"));
      return children.length ? children : [wrapper];
    });
  const counters = primary.length ? primary : fallback;
  return counters
    .map((counter) => ({
      name: textOf(counter.querySelector("h5.pseudo, [class*='pseudo' i]")) || textOf(counter).split(" ")[0] || "",
      score: extractElementScoreValue(counter),
      raw: textOf(counter)
    }))
    .filter((player) => player.name || player.score || player.raw);
}

function readTcgaCounterScore(players: CounterPlayer[], localName: string): { me: string; opp: string; raw: string[]; source: string } {
  const raw = players.map((player) => player.raw);
  if (!players.length) {
    return { me: "", opp: "", raw, source: "none" };
  }
  const localKey = normalizeNameKey(localName);
  if (localKey) {
    const me = players.find((player) => normalizeNameKey(player.name) === localKey);
    const opp = players.find((player) => normalizeNameKey(player.name) !== localKey && player.score);
    if (me?.score) {
      return { me: me.score, opp: opp?.score ?? "", raw, source: "tcga-counter-player" };
    }
    return { me: "", opp: "", raw, source: "none" };
  }
  const values = players.map((player) => player.score).filter(Boolean);
  if (values.length >= 2) {
    return { me: values[0] ?? "", opp: values[1] ?? "", raw, source: "tcga-counter-order" };
  }
  return { me: "", opp: "", raw, source: "none" };
}

function readAtlasScore(
  bodyText: string,
  logRows: Array<{ text: string }>,
  candidates = readAtlasScoreTrackCandidates()
): { me: string; opp: string; raw: string[]; source: string } {
  const track = scoreFromAtlasTrackCandidates(candidates);
  if (track.me !== "" && track.opp !== "") {
    return track;
  }

  const raw = [
    ...logRows.map((row) => row.text).slice(-8),
    ...candidates.map((candidate) => candidate.raw)
  ].filter((text) => text && !isAtlasNonScoreText(text));

  if (/you win|you lose|you won|you lost|victory|defeat|match complete|game over/i.test(bodyText) && /\b(final score|score\s*:|points\s*:)/i.test(bodyText)) {
    const paired = scoreFromText(bodyText);
    if (paired.me !== "" && paired.opp !== "") {
      return { ...paired, raw: [...raw, "atlas-explicit-result-score"], source: "atlas-result-text" };
    }
  }

  return { me: "", opp: "", raw: raw.slice(0, 12), source: "none" };
}

function extractElementScoreValue(element: Element): string {
  const controls = Array.from(element.querySelectorAll("input[type='number'], [aria-valuenow], [data-score], [data-points], [data-counter], [data-value], [value]"));
  for (const control of controls) {
    const value = scoreNumber(
      (control as HTMLInputElement).value ||
        attr(control, "aria-valuenow") ||
        attr(control, "data-score") ||
        attr(control, "data-points") ||
        attr(control, "data-counter") ||
        attr(control, "data-value") ||
        attr(control, "value")
    );
    if (value) {
      return value;
    }
  }

  const labelled = Array.from(element.querySelectorAll("[aria-label], [title]"));
  for (const node of labelled) {
    const value = scoreFromText(`${attr(node, "aria-label")} ${attr(node, "title")}`)?.me;
    if (value) {
      return value;
    }
  }

  const text = textOf(element);
  const explicit = scoreFromText(text);
  if (explicit.me && explicit.opp) {
    return "";
  }
  if (explicit.me) {
    return explicit.me;
  }
  const numbers = text.match(/\b([0-9]|[1-9][0-9])\b/g) ?? [];
  return text.length <= 120 && numbers.length === 1 ? numbers[0] : "";
}

function scoreNumber(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const match = raw.match(/\b([0-9]|[1-9][0-9])\b/);
  return match?.[1] ?? "";
}

function scoreFromText(text: string): { me: string; opp: string } {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) {
    return { me: "", opp: "" };
  }
  const direct = clean.match(/(?:score|points?|damage|counter)\D{0,24}([0-9]|[1-9][0-9])\s*[-:\/]\s*([0-9]|[1-9][0-9])/i);
  if (direct) {
    return { me: direct[1] ?? "", opp: direct[2] ?? "" };
  }
  const labelled = clean.match(/(?:you|me|my|player|local)\D{0,32}([0-9]|[1-9][0-9]).{0,80}(?:opponent|opp|enemy|rival|remote)\D{0,32}([0-9]|[1-9][0-9])/i);
  if (labelled) {
    return { me: labelled[1] ?? "", opp: labelled[2] ?? "" };
  }
  const reverseLabelled = clean.match(/(?:opponent|opp|enemy|rival|remote)\D{0,32}([0-9]|[1-9][0-9]).{0,80}(?:you|me|my|player|local)\D{0,32}([0-9]|[1-9][0-9])/i);
  if (reverseLabelled) {
    return { me: reverseLabelled[2] ?? "", opp: reverseLabelled[1] ?? "" };
  }
  const resultPair = clean.match(/(?:\byou\s+win\b|\byou\s+won\b|\bvictory\b|\byou\s+lose\b|\byou\s+lost\b|\bdefeat\b|\bwin\b|\bwins\b|\bwinner\b)\D{0,48}([0-9]|[1-9][0-9])\s*[-:\/]\s*([0-9]|[1-9][0-9])/i);
  if (resultPair) {
    return { me: resultPair[1] ?? "", opp: resultPair[2] ?? "" };
  }
  const opponentResultPair = clean.match(/(?:opponent|opp|enemy|rival|remote)\D{0,32}(?:\bwin\b|\bwins\b|\bwon\b|\bvictory\b)\D{0,48}([0-9]|[1-9][0-9])\s*[-:\/]\s*([0-9]|[1-9][0-9])/i);
  if (opponentResultPair) {
    return { me: opponentResultPair[2] ?? "", opp: opponentResultPair[1] ?? "" };
  }
  return { me: "", opp: "" };
}

function readAtlasScoreTrackCandidates(): AtlasScoreCandidate[] {
  const selectors = [
    "[aria-label^='Set your score to']",
    "[aria-label*='score' i]",
    "[class*='track-node' i]",
    "[class*='gb-track' i]",
    "[class*='track-outline' i]",
    "[class*='track-ring' i]"
  ];
  const elements = uniqueElements(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))).slice(0, 48);
  const candidates = elements
    .map(readAtlasScoreTrackCandidate)
    .filter((candidate): candidate is AtlasScoreCandidate => Boolean(candidate && candidate.value !== ""));
  return candidates
    .filter((candidate) => candidate.active || candidate.side || /score/i.test(candidate.ariaLabel))
    .slice(0, 24);
}

function scoreFromAtlasTrackCandidates(candidates: AtlasScoreCandidate[]): { me: string; opp: string; raw: string[]; source: string } {
  const active = candidates.filter((candidate) => candidate.active && candidate.value !== "");
  const me = active.find((candidate) => candidate.side === "me") ?? active.find((candidate) => /^set your score to/i.test(candidate.ariaLabel));
  const opp = active.find((candidate) => candidate.side === "opponent") ??
    active.find((candidate) => candidate !== me && candidate.side === "" && !/^set your score to/i.test(candidate.ariaLabel));
  if (!me || !opp) {
    return {
      me: "",
      opp: "",
      raw: candidates.slice(0, 8).map((candidate) => candidate.raw),
      source: "none"
    };
  }
  return {
    me: me.value,
    opp: opp.value,
    raw: [me.raw, opp.raw].filter(Boolean),
    source: "atlas-score-track"
  };
}

function readAtlasScoreTrackCandidate(element: Element): AtlasScoreCandidate | null {
  const react = readReactScoreProps(element);
  const ariaLabel = attr(element, "aria-label");
  const classes = attr(element, "class");
  const text = textOf(element);
  const value = react?.value || scoreFromSetScoreLabel(ariaLabel) || scoreFromTinyText(text);
  if (value === "") {
    return null;
  }
  const rect = element.getBoundingClientRect();
  const active = react?.active === true || attr(element, "aria-pressed") === "true" || isActiveAtlasScoreClass(classes);
  const side = react?.variant === "player"
    ? "me"
    : react?.variant === "opponent"
      ? "opponent"
      : /^set your score to/i.test(ariaLabel)
        ? "me"
        : "";
  return {
    side,
    value,
    active,
    source: react ? "react-score-track" : ariaLabel ? "aria-score-track" : "class-score-track",
    raw: [
      side || "unknown",
      active ? "active" : "inactive",
      value,
      ariaLabel || text.slice(0, 60)
    ].filter(Boolean).join(":"),
    classes: classes.slice(0, 260),
    ariaLabel,
    top: Math.round(rect.top),
    left: Math.round(rect.left)
  };
}

function readReactScoreProps(element: Element): ReactScoreProps | null {
  const record = element as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key.startsWith("__reactProps$")) {
      const props = parseReactScoreProps(record[key]);
      if (props) {
        return props;
      }
    }
    if (key.startsWith("__reactFiber$")) {
      let fiber = record[key] as { memoizedProps?: unknown; return?: unknown } | null;
      for (let depth = 0; fiber && depth < 8; depth += 1) {
        const props = parseReactScoreProps(fiber.memoizedProps);
        if (props) {
          return props;
        }
        fiber = fiber.return as { memoizedProps?: unknown; return?: unknown } | null;
      }
    }
  }
  return null;
}

function parseReactScoreProps(value: unknown): ReactScoreProps | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const props = value as Record<string, unknown>;
  const scoreValue = scoreNumber(props.value);
  const variant = typeof props.variant === "string" ? props.variant : "";
  if (scoreValue === "" || (variant !== "player" && variant !== "opponent" && typeof props.isActive !== "boolean")) {
    return null;
  }
  return {
    value: scoreValue,
    variant,
    active: props.isActive === true
  };
}

function scoreFromSetScoreLabel(value: string): string {
  return value.match(/\bset your score to\s+([0-9]|[1-9][0-9])\b/i)?.[1] ?? "";
}

function scoreFromTinyText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return /^([0-9]|[1-9][0-9])$/.test(text) ? text : "";
}

function isActiveAtlasScoreClass(value: string): boolean {
  const classes = value.toLowerCase();
  return classes.includes("before:opacity-100") ||
    classes.includes("track-outline-glow") ||
    classes.includes("rgba(120,221,183") ||
    classes.includes("rgba(255,187,110") ||
    classes.includes("rgba(238,201,144") ||
    classes.includes("rgba(230,191,134") ||
    classes.includes("rgba(248,196,124");
}

function uniqueElements(elements: Element[]): Element[] {
  return [...new Set(elements)].filter(isVisibleElement);
}

function isVisibleElement(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isAtlasNonScoreText(text: string): boolean {
  return /sideboarding|lock in sideboard|locked in sideboarding|waiting for .*lock in sideboard|main deck\s*\d+\s*\/\s*\d+|sideboard\s*\d+\s*\/\s*\d+/i.test(text);
}

function scoreFromUnknown(value: unknown, depth = 0): { me: string; opp: string; raw: string[]; source: string } {
  if (depth > 5 || value == null) {
    return { me: "", opp: "", raw: [], source: "none" };
  }
  if (typeof value === "string") {
    const paired = scoreFromText(value);
    return { ...paired, raw: value ? [value.slice(0, 300)] : [], source: paired.me || paired.opp ? "network-text" : "none" };
  }
  if (typeof value !== "object") {
    return { me: "", opp: "", raw: [], source: "none" };
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 80)) {
      const nested = scoreFromUnknown(item, depth + 1);
      if (nested.me || nested.opp) {
        return nested;
      }
    }
    return { me: "", opp: "", raw: [], source: "none" };
  }

  const record = value as Record<string, unknown>;
  const direct = scoreFromRecord(record);
  if (direct.me || direct.opp) {
    return { ...direct, raw: [], source: "network-json" };
  }
  for (const [key, nested] of Object.entries(record)) {
    if (!SCORE_KEYS.test(key) && typeof nested !== "object") {
      continue;
    }
    const found = scoreFromUnknown(nested, depth + 1);
    if (found.me || found.opp) {
      return found;
    }
  }
  return { me: "", opp: "", raw: [], source: "none" };
}

function scoreFromRecord(record: Record<string, unknown>): { me: string; opp: string } {
  const myKeys = ["me", "my", "mine", "myScore", "my_score", "myPoints", "my_points", "playerScore", "player_score", "playerPoints", "player_points", "localScore", "local_score"];
  const oppKeys = ["opp", "opponent", "enemy", "their", "opponentScore", "opponent_score", "oppScore", "opp_score", "opponentPoints", "opponent_points", "oppPoints", "opp_points", "remoteScore", "remote_score"];
  const me = firstRecordNumber(record, myKeys);
  const opp = firstRecordNumber(record, oppKeys);
  if (me || opp) {
    return { me, opp };
  }
  const nestedScore = record.score ?? record.scores ?? record.points ?? record.counters;
  if (nestedScore && typeof nestedScore === "object" && !Array.isArray(nestedScore)) {
    return scoreFromRecord(nestedScore as Record<string, unknown>);
  }
  return { me: "", opp: "" };
}

function firstRecordNumber(record: Record<string, unknown>, keys: string[]): string {
  const lowerLookup = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const value = lowerLookup.get(key.toLowerCase());
    const number = scoreNumber(value);
    if (number) {
      return number;
    }
  }
  return "";
}

function normalizeNameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function collectTcgaBattlefieldCandidates(): BattlefieldCandidate[] {
  return Array.from(document.querySelectorAll(".game-card.Battlefields"))
    .map((element, listIndex) => {
      const img = element.querySelector("img.card-front, img") as HTMLImageElement | null;
      const image = img?.currentSrc || img?.src || attr(img, "data-src") || attr(img, "alt");
      const classes = attr(element, "class");
      const code = attr(element, "data-card-id") || attr(img, "data-card-id") || cardCodeFromImage(image);
      const side: BattlefieldCandidate["side"] = classes.includes("opponent-card") ? "opponent" : "me";
      const rect = element.getBoundingClientRect();
      const index = classNumber(classes, "index");
      const reversedIndex = classNumber(classes, "reversed-index");
      const hidden = /card-hidden-yes|ExileHidden/i.test(classes) || isCardBackImage(image);
      return {
        side,
        image,
        code,
        text: textOf(element).slice(0, 180),
        classes,
        hidden,
        capturedAt: now(),
        listIndex,
        index,
        reversedIndex,
        rect: {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    })
    .filter((candidate) => candidate.image || candidate.code || candidate.text);
}

function battlefieldImageFor(candidates: BattlefieldCandidate[], side: BattlefieldCandidate["side"], requireUnique = false): string {
  const usable = candidates.filter((candidate) =>
    candidate.side === side &&
    !candidate.hidden &&
    candidate.image &&
    !isCardBackImage(candidate.image) &&
    !isGeneratedBattlefieldCandidate(candidate)
  );
  const uniqueImages = Array.from(new Map(usable.map((candidate) => [normalizeAssetKey(candidate.image), candidate.image])).values());
  if (requireUnique && uniqueImages.length !== 1) {
    return "";
  }
  return uniqueImages[0] ?? "";
}

function isGeneratedBattlefieldCandidate(candidate: BattlefieldCandidate): boolean {
  return /\bbaron\s+pit\b/i.test(`${candidate.text} ${candidate.code}`) ||
    /baron[-_\s]?pit|e44f173629322a4e0c32d3f8902c294d4482ef42/i.test(candidate.image);
}

function classNumber(classes: string, name: string): number | undefined {
  const match = classes.match(new RegExp(`(?:^|\\s)${name}-(\\d+)(?:\\s|$)`));
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

function isCardBackImage(value: string): boolean {
  return /cardback|card-back|back-black|back\.png/i.test(value);
}

function normalizeAssetKey(value: string): string {
  return value.trim().toLowerCase().replace(/[?#].*$/, "");
}

function readTcgaBattlefieldText(bodyText: string, localPlayerName: string, opponentName: string): { me: string; opponent: string; evidence: string[] } {
  const lines = bodyText.split(/[\n\r]+/).map((line) => line.trim()).filter(Boolean);
  const localKey = normalizeNameKey(localPlayerName);
  const opponentKey = normalizeNameKey(opponentName);
  const evidence: string[] = [];
  let me = "";
  let opponent = "";
  const playerHeaderRe = /^([A-Za-z0-9_.\-\s]+?)\s*(?:-\s*\d{1,2}:\d{2})?$/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lower = line.toLowerCase();
    if (!/(revealed|placed|played)/i.test(line) || lower.includes("removed")) {
      continue;
    }
    const battlefield = matchBattlefieldName(line);
    if (!battlefield || /\brevealed\s+a\s+card\b/i.test(line)) {
      continue;
    }
    const explicitPlayer = playerFromBattlefieldAction(line);
    const previousPlayer = i > 0 ? playerHeaderRe.exec(lines[i - 1])?.[1]?.trim() ?? "" : "";
    const player = explicitPlayer || previousPlayer;
    const playerKey = normalizeNameKey(player);
    if (playerKey && localKey && playerKey === localKey) {
      me = battlefield;
      evidence.push(`${player}: ${line}`);
    } else if (playerKey && opponentKey && playerKey === opponentKey) {
      opponent = battlefield;
      evidence.push(`${player}: ${line}`);
    } else if (/\byou\b/i.test(line)) {
      me = battlefield;
      evidence.push(line);
    }
  }

  return { me, opponent, evidence: evidence.slice(-8) };
}

function playerFromBattlefieldAction(line: string): string {
  const match = line.match(/^([A-Za-z0-9_.\-\s]+?)\s+(?:revealed|placed|played)\b/i);
  return match?.[1]?.trim() ?? "";
}

function matchBattlefieldName(text: string): string {
  const normalizedText = normalizeBattlefieldSearch(text);
  for (const entry of BATTLEFIELD_NAMES) {
    if (normalizedText.includes(normalizeBattlefieldSearch(entry.name))) {
      return entry.canonical;
    }
  }
  return "";
}

function normalizeBattlefieldSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[^a-z0-9]+/g, "");
}

function cardCodeFromImage(value: string): string {
  const match = value.match(/\b([A-Z]{2,5}-\d{1,4})\b/i);
  return match?.[1]?.toUpperCase() ?? "";
}

function readTcgaSnapshot(): Record<string, unknown> {
  const bodyText = documentText();
  const counterPlayers = readTcgaCounterPlayers();
  const playerData = readLocalStorageJson("player_data");
  const localPlayerName = readTcgaLocalPlayerName(playerData) || readTcgaProfileName(playerData);
  const score = readTcgaCounterScore(counterPlayers, localPlayerName);
  const localKey = normalizeNameKey(localPlayerName);
  const localCounter = localKey ? counterPlayers.find((player) => normalizeNameKey(player.name) === localKey) : undefined;
  const opponentCounter = localKey ? counterPlayers.find((player) => normalizeNameKey(player.name) !== localKey && player.name) : undefined;
  const opponentName = opponentCounter?.name || counterPlayers.find((player) => player.name && player.name !== (localCounter?.name ?? ""))?.name || "";
  const battlefieldCandidates = collectTcgaBattlefieldCandidates();
  const battlefieldText = readTcgaBattlefieldText(bodyText, localCounter?.name || localPlayerName, opponentName);
  const myBattlefieldImage = battlefieldText.me ? "" : battlefieldImageFor(battlefieldCandidates, "me", true);
  const opponentFallbackImage = imageIdentity(
    ".game-card.Battlefields.opponent-card.card-hidden-no img.card-front",
    ".game-card.Battlefields.opponent-card.card-hidden-no img"
  );
  const opponentBattlefieldImage = battlefieldText.opponent
    ? ""
    : battlefieldImageFor(battlefieldCandidates, "opponent") || (isCardBackImage(opponentFallbackImage) ? "" : opponentFallbackImage);
  const endText = findTcgaEndText();
  const tcgaPhase = readTcgaPhase(bodyText);
  const cards = DECK_TRACKER_FEATURE_ENABLED ? collectTcgaVisibleCards() : [];
  const cardZoneOverlay = isTcgaCardZoneOverlay(bodyText);
  const hasOpponentCounter = Boolean(opponentName) || counterPlayers.length > 1;
  const hasScoreSignal = score.source !== "none" && (score.me !== "" || score.opp !== "" || score.raw.length > 1);
  const active = Boolean(endText || cardZoneOverlay || hasOpponentCounter || hasScoreSignal || (tcgaPhase === "playing" && counterPlayers.length > 1));
  return {
    active,
    myName: localCounter?.name || localPlayerName || counterPlayers[0]?.name || "",
    opponentName,
    score,
    counterPlayers,
    localPlayerName,
    tcgaPhase,
    tcgaCardZoneOverlay: cardZoneOverlay,
    turnText: readTcgaTurnText(bodyText),
    tcgaIdentity: {
      pseudo: localPlayerName,
      opponentName
    },
    myChampionImage: imageIdentity(
      ".game-card.Legend:not(.opponent-card) img.card-front",
      ".game-card.Legend:not(.opponent-card) img"
    ),
    opponentChampionImage: imageIdentity(
      ".game-card.Legend.opponent-card img.card-front",
      ".opponent-card.game-card.Legend img"
    ),
    myBattlefield: battlefieldText.me,
    opponentBattlefield: battlefieldText.opponent,
    myBattlefieldImage,
    opponentBattlefieldImage,
    battlefieldCandidates,
    battlefieldTextEvidence: battlefieldText.evidence,
    ...(DECK_TRACKER_FEATURE_ENABLED ? { cards, deckTrackerCards: collectTcgaDeckTrackerCards(cards) } : {}),
    selectedDeck: readTcgaDeck(),
    endText
  };
}

function findTcgaEndText(): string {
  const candidates = Array.from(document.querySelectorAll("button, a, h1, h2, h3, [role='dialog'], [class*='modal'], [class*='dialog'], [class*='result']"));
  for (const candidate of candidates) {
    const value = textOf(candidate);
    if (!value || isTcgaShellOrPlayControlText(value)) {
      continue;
    }
    if (/\b(you win|you lose|victory|defeat|match complete)\b|wins!/i.test(value)) {
      return value;
    }
    if (/\b(return to lobby|back to lobby|play again|rematch)\b/i.test(value) && scoreFromText(value).me && scoreFromText(value).opp) {
      return value;
    }
  }
  return "";
}

function isTcgaShellOrPlayControlText(value: string): boolean {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) {
    return true;
  }
  if (/you need to enable javascript/i.test(clean)) {
    return true;
  }
  const playControls = [
    /end your turn/i,
    /pause before drawing/i,
    /disable auto untap/i,
    /toggle eliminated/i,
    /connect with other players/i,
    /manage turn order/i,
    /start a new game/i,
    /cancel all forwards/i,
    /roll a dice/i
  ];
  const controlHits = playControls.filter((pattern) => pattern.test(clean)).length;
  return controlHits >= 2;
}

function isTcgaCardZoneOverlay(bodyText: string): boolean {
  if (!/trash|discard|grave|removed|banish|exile/i.test(bodyText)) {
    return false;
  }
  if (!/opponent|enemy|your|player|card/i.test(bodyText)) {
    return false;
  }
  return Boolean(document.querySelector(
    "[role='dialog'], [class*='modal' i], [class*='dialog' i], [class*='drawer' i], [class*='overlay' i], [class*='trash' i], [class*='discard' i], [class*='grave' i], [data-drop-zone*='trash' i], [data-drop-zone*='discard' i]"
  ));
}

function readTcgaPhase(bodyText: string): string {
  if (/mulligan|starting hand|redraw|keep hand|choose.*cards/i.test(bodyText)) {
    return "mulligan";
  }
  if (/\bturn\b|end turn|combat|attack|block|concede|report winner/i.test(bodyText)) {
    return "playing";
  }
  return "";
}

function readTcgaTurnText(bodyText: string): string {
  const direct = findText(/your turn|opponent['\u2019]?s turn|.{1,48}['\u2019]s turn/i);
  const matched = direct.match(/your turn|opponent['\u2019]?s turn|.{1,48}['\u2019]s turn/i)?.[0]?.trim() ?? "";
  if (matched) {
    return matched;
  }
  return /\bend turn\b/i.test(bodyText) ? "Your turn" : "";
}

function readAtlasSnapshot(): Record<string, unknown> {
  const bodyText = documentText();
  const nonGamePage = isAtlasNonGamePage();
  const logRows = Array.from(document.querySelectorAll("ul li, [role='log'] li, [class*='log' i] li, [class*='matchLog' i] li"))
    .slice(-28)
    .map((row, index) => ({ key: `${index}:${textOf(row).slice(0, 120)}`, text: textOf(row) }))
    .filter((row) => row.text);
  const zoneCards = collectCards("[data-card-id], [data-drop-zone] [data-card-id], [data-zone-owner] [data-drop-zone]", {
    limit: 42,
    includeText: true,
    includeClasses: true
  });
  const rawTerminalText = findText(/(?:confirm|choose|select|report)\s+game\s+\d+\s+winner|(?:confirm|choose|select|report)\s+(?:the\s+)?winner\s+(?:for|of)\s+game\s+\d+|game\s+\d+.{0,48}(?:winner|choose|select|confirm|report)|you win|you lose|you won|you lost|victory|defeat|wins!|winner|match complete|game over|opponent.*left|left the game|disconnected/i);
  const terminalText = normalizeAtlasTerminalText(rawTerminalText);
  const sideboarding = !nonGamePage && isAtlasSideboarding(bodyText);
  const atlasBo3Queue = !nonGamePage && isAtlasBo3QueueScreen(bodyText, terminalText);
  const atlasBo3GameNumberValue = atlasBo3GameNumber(`${terminalText} ${bodyText}`);
  const atlasContinuationText = !nonGamePage &&
    (atlasBo3Queue ||
      sideboarding ||
      atlasBo3GameNumberValue > 0 ||
      /(?:best\s+of\s+3|bo3|sideboarding|next game|\bgame\s+[23]\b)/i.test(`${terminalText} ${bodyText}`));
  const gameplayRows = logRows.some((row) =>
    /starting turn|mulligan|played|wins!|reported|round|combat|attack|block|left the game|opponent.*left/i.test(row.text) &&
    !/sideboarding|locked in sideboarding|lock in sideboard/i.test(row.text)
  );
  const inGameText = !nonGamePage && !sideboarding && /concede|report winner|request rematch|opponent.*left|left the game|disconnected|\bturn\b|mulligan|played|wins!|winner|\bround\b|combat|attack|block/i.test(bodyText);
  const atlasScoreCandidates = sideboarding ? [] : readAtlasScoreTrackCandidates();
  const score = sideboarding ? { me: "", opp: "", raw: [], source: "none" } : readAtlasScore(bodyText, logRows, atlasScoreCandidates);
  const hasScoreEvidence = Number.parseInt(score.me, 10) > 0 || Number.parseInt(score.opp, 10) > 0;
  const boardSelector = document.querySelector(
    "[data-drop-zone-root], [data-zone-owner], [data-owner], [class*='game-board' i], [class*='play-area' i], canvas"
  );
  const ownedBoardSelector = document.querySelector(
    '[data-zone-owner="opponent"], [data-zone-owner="self"], [data-zone-owner="player"], [data-owner="opponent"], [data-owner="self"], [data-owner="player"]'
  );
  const realZoneCards = zoneCards.some((card) => Boolean(card.zoneOwner) && isRealAtlasCardImage(card.image));
  const cardZoneOverlay = Boolean(
    !terminalText &&
      !sideboarding &&
      /trash|discard|grave|removed|banish/i.test(bodyText) &&
      /opponent|enemy|your|player|card/i.test(bodyText) &&
      document.querySelector(
        "[role='dialog'], [class*='modal' i], [class*='dialog' i], [class*='drawer' i], [class*='overlay' i], [class*='trash' i], [class*='discard' i], [data-drop-zone*='trash' i], [data-drop-zone*='discard' i]"
      )
  );
  const hardLobby = /paste a deck|host room|join room|find random match|quick match|choose deck|import deck|new deck|save deck/i.test(bodyText) &&
    !inGameText &&
    !terminalText &&
    !cardZoneOverlay &&
    !ownedBoardSelector &&
    !realZoneCards &&
    !gameplayRows &&
    !hasScoreEvidence;
  const boardEvidence = Boolean(
    !nonGamePage &&
      !hardLobby &&
      (ownedBoardSelector ||
      realZoneCards ||
      cardZoneOverlay ||
      gameplayRows ||
      hasScoreEvidence ||
      (boardSelector && inGameText) ||
      terminalText)
  );
  const active = Boolean(
    !nonGamePage &&
      boardEvidence &&
      (ownedBoardSelector ||
        realZoneCards ||
        cardZoneOverlay ||
        logRows.length ||
        hasScoreEvidence ||
        inGameText ||
        terminalText)
  );
  const atlasPlayers = nonGamePage
    ? { me: "", opponent: "", candidates: [] }
    : readAtlasPlayers(bodyText, logRows, active || boardEvidence || hasScoreEvidence || gameplayRows);
  const myLegendCard = atlasCardByZone(zoneCards, "self", "legend");
  const opponentLegendCard = atlasCardByZone(zoneCards, "opponent", "legend");
  const battlefieldCards = readAtlasBattlefieldCards(zoneCards);
  const myBattlefieldCard = battlefieldCards.find((card) => card.zone === "battlefieldB") ?? emptyAtlasCard();
  const opponentBattlefieldCard = battlefieldCards.find((card) => card.zone === "battlefieldA") ?? emptyAtlasCard();
  return {
    active,
    score,
    atlasScoreCandidates: atlasScoreCandidates.map((candidate) => ({
      side: candidate.side,
      value: candidate.value,
      active: candidate.active,
      source: candidate.source,
      raw: candidate.raw,
      top: candidate.top,
      left: candidate.left
    })).slice(0, 10),
    rows: logRows,
    roomCode: readRoomCode(bodyText),
    format: readAtlasFormat(bodyText),
    atlasSideboarding: sideboarding,
    atlasBo3Queue,
    atlasBo3GameNumber: atlasBo3GameNumberValue,
    pageText: atlasContinuationText ? bodyText.slice(0, 1200) : "",
    atlasCardZoneOverlay: cardZoneOverlay,
    atlasResultKind: classifyAtlasResult(terminalText),
    myName: atlasPlayers.me,
    opponentName: atlasPlayers.opponent,
    atlasPlayerCandidates: atlasPlayers.candidates,
    myChampionImage: myLegendCard.image,
    opponentChampionImage: opponentLegendCard.image,
    myBattlefield: "",
    opponentBattlefield: "",
    myBattlefieldImage: myBattlefieldCard.image,
    opponentBattlefieldImage: opponentBattlefieldCard.image,
    battlefieldCandidates: [
      atlasBattlefieldCandidate("me", myBattlefieldCard),
      atlasBattlefieldCandidate("opponent", opponentBattlefieldCard)
    ].filter((candidate) => candidate.image || candidate.code || candidate.text),
    ...(DECK_TRACKER_FEATURE_ENABLED ? { deckTrackerCards: collectAtlasDeckTrackerCards(zoneCards) } : {}),
    endText: terminalText
  };
}

function isAtlasNonGamePage(): boolean {
  const host = location.hostname.toLowerCase();
  const path = location.pathname.toLowerCase();
  if (host === "riftatlas.com" || host === "www.riftatlas.com") {
    return /^\/decks(?:\/|$)/.test(path) ||
      /^\/collection(?:\/|$)/.test(path) ||
      /^\/cards(?:\/|$)/.test(path) ||
      /^\/profile(?:\/|$)/.test(path);
  }
  return false;
}

function collectTcgaVisibleCards(): Array<Record<string, string>> {
  return collectCards(
    [
      ".game-card",
      "[data-card-id]",
      "[data-drop-zone] [data-card-id]",
      "img[src*='/cards/']",
      "img[src*='game_data_live']"
    ].join(", "),
    {
      limit: 140,
      includeText: true,
      includeClasses: true
    }
  );
}

function collectTcgaDeckTrackerCards(cards: Array<Record<string, string>> = collectTcgaVisibleCards()): Array<Record<string, unknown>> {
  return cards
    .map((card) => deckTrackerObservationFromCard(card, "tcga"))
    .filter((card): card is Record<string, unknown> => Boolean(card));
}

function collectAtlasDeckTrackerCards(cards: Array<Record<string, string>>): Array<Record<string, unknown>> {
  return cards
    .map((card) => deckTrackerObservationFromCard(card, "atlas"))
    .filter((card): card is Record<string, unknown> => Boolean(card));
}

function deckTrackerObservationFromCard(card: Record<string, string>, sourcePlatform: GamePlatform): Record<string, unknown> | null {
  const classes = card.classes || "";
  const zone = normalizeDeckTrackerZone(card.zone, classes);
  const code = card.code || cardCodeFromImage(card.image);
  const name = usefulDeckTrackerCardText(card.text);
  const cardId = card.cardId || "";
  if (sourcePlatform === "atlas" && !isLocalAtlasDeckTrackerCard(card)) {
    return null;
  }
  if (sourcePlatform === "tcga" && /opponent-card/i.test(classes)) {
    return null;
  }
  if (shouldIgnoreDeckTrackerCard(card, zone)) {
    return null;
  }
  const cardKey = normalizeDeckTrackerKey(cardId || code || name);
  if (!cardKey) {
    return null;
  }
  return {
    cardKey,
    name,
    code,
    cardId,
    imageUrl: card.image,
    zone,
    count: 1,
    platform: sourcePlatform,
    confidence: cardId || code ? "tracked" : "estimated"
  };
}

function isLocalAtlasDeckTrackerCard(card: Record<string, string>): boolean {
  return /^(self|player|me|local)$/i.test(card.zoneOwner || "");
}

function shouldIgnoreDeckTrackerCard(card: Record<string, string>, zone: string): boolean {
  const classes = card.classes || "";
  const zoneText = card.zone || "";
  const image = card.image || "";
  if (!zone || /legend|battlefield|rune|sideboard|deck/i.test(zoneText)) {
    return true;
  }
  if (/Legend|Battlefields|Rune|Sideboard|card-hidden|hidden|card-back/i.test(classes)) {
    return true;
  }
  if (/cardback|card-back/i.test(image)) {
    return true;
  }
  if (!card.cardId && !card.code && !card.image && !usefulDeckTrackerCardText(card.text)) {
    return true;
  }
  return false;
}

function normalizeDeckTrackerZone(zone: string, classes: string): string {
  const source = `${zone} ${classes}`.toLowerCase();
  if (/hand/.test(source)) {
    return "hand";
  }
  if (/base|board|bench|field|unit|battle/.test(source)) {
    return "board";
  }
  if (/stack|chain/.test(source)) {
    return "stack";
  }
  if (/trash|discard|grave/.test(source)) {
    return source.includes("discard") ? "discard" : "trash";
  }
  return "unknown";
}

function usefulDeckTrackerCardText(value: string): string {
  const text = usefulAtlasCardText(value).replace(/\s+/g, " ").trim();
  if (!text || /^(target|tap|ping|error|unknown card|no card|auto pay|energy|power)$/i.test(text)) {
    return "";
  }
  return text.slice(0, 80);
}

function normalizeDeckTrackerKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function readAtlasFormat(bodyText: string): "Bo1" | "Bo3" | "Auto" {
  const selected = Array.from(document.querySelectorAll("[aria-pressed='true'], [aria-selected='true'], [data-state='checked'], [data-selected='true'], .selected, .active"))
    .filter(isVisibleElement)
    .map((element) => textOf(element))
    .find((text) => /best of [13]|bo[13]/i.test(text));
  const source = selected || bodyText;
  const hasBo3 = /best of 3|bo3/i.test(source);
  const hasBo1 = /best of 1|bo1/i.test(source);
  if (!selected && hasBo1 && hasBo3) {
    return "Auto";
  }
  if (/best of 3|bo3/i.test(source)) {
    return "Bo3";
  }
  if (/best of 1|bo1/i.test(source)) {
    return "Bo1";
  }
  return "Auto";
}

function classifyAtlasResult(value: string): "game-result" | "match-terminal" | "" {
  if (!value) {
    return "";
  }
  if (/opponent.*left|left the game|disconnected|match complete|game over/i.test(value)) {
    return "match-terminal";
  }
  if (atlasBo3GameNumber(value) > 0 || /(?:confirm|choose|select|report)\s+(?:the\s+)?winner/i.test(value)) {
    return "game-result";
  }
  if (/you win|you lose|you won|you lost|victory|defeat|wins!|winner/i.test(value)) {
    return "game-result";
  }
  return "";
}

function normalizeAtlasTerminalText(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return "";
  }
  if (/^cancel\b.*\breturn to lobby$/i.test(raw)) {
    return "";
  }
  return raw;
}

function isAtlasSideboarding(bodyText: string): boolean {
  return /sideboarding|lock in sideboard|locked in sideboarding|waiting for .*lock in sideboard|main deck\s*\d+\s*\/\s*\d+|sideboard\s*\d+\s*\/\s*\d+/i.test(bodyText);
}

function isAtlasBo3QueueScreen(bodyText: string, terminalText = ""): boolean {
  const text = `${terminalText} ${bodyText}`;
  if (/match complete|game over|opponent.*left|left the game|disconnected/i.test(text)) {
    return false;
  }
  const gameNumber = atlasBo3GameNumber(text);
  if (gameNumber > 0 && gameNumber < 3) {
    return true;
  }
  const hasBetweenGameText = /sideboarding|lock in sideboard|locked in sideboarding|waiting for .*lock in sideboard|next game|start game|continue/i.test(text);
  if (hasBetweenGameText && /\bgame\s+[23]\b/i.test(text)) {
    return true;
  }
  return /(?:best\s+of\s+3|bo3)/i.test(text) &&
    /sideboarding|lock in sideboard|locked in sideboarding|waiting for .*lock in sideboard|next game|game\s+[12]\s+of\s+3/i.test(text);
}

function atlasBo3GameNumber(text: string): number {
  const patterns = [
    /(?:confirm|choose|select|report)\s+game\s+([123])\s+winner/i,
    /(?:confirm|choose|select|report)\s+(?:the\s+)?winner\s+(?:for|of)\s+game\s+([123])/i,
    /game\s+([123])\s+(?:winner|of\s+3)/i,
    /game\s+([123]).{0,48}(?:confirm|choose|select|report).{0,24}winner/i,
    /(?:confirm|choose|select|report).{0,24}winner.{0,48}game\s+([123])/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }
  return 0;
}

function emptyAtlasCard(): { text: string; image: string; code: string; zone?: string } {
  return { text: "", image: "", code: "" };
}

function atlasCardByZone(cards: Array<Record<string, string>>, owner: "self" | "opponent", zone: string): { text: string; image: string; code: string; zone?: string } {
  const card = cards.find((candidate) =>
    atlasOwnerMatches(candidate.zoneOwner, owner) &&
    atlasZoneMatches(candidate.zone, zone) &&
    isRealAtlasCardImage(candidate.image)
  );
  if (!card) {
    return emptyAtlasCard();
  }
  return {
    text: usefulAtlasCardText(card.text),
    image: card.image,
    code: card.code || cardCodeFromImage(card.image),
    zone
  };
}

function atlasOwnerMatches(value: string, owner: "self" | "opponent"): boolean {
  const normalized = value.trim().toLowerCase();
  if (owner === "self") {
    return /^(self|player|me|local)$/i.test(normalized);
  }
  return /^(opponent|enemy|remote)$/i.test(normalized);
}

function atlasZoneMatches(value: string, zone: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const requested = zone.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (requested === "legend") {
    return ["legend", "champion", "chosenchampion", "chosenlegend", "leader"].includes(normalized);
  }
  return normalized === requested;
}

function readAtlasBattlefieldCards(cards: Array<Record<string, string>>): Array<{ text: string; image: string; code: string; zone: string }> {
  return ["battlefieldA", "battlefieldB", "battlefieldC"]
    .map((zone) => {
      const marker = cards.find((card) =>
        card.zone === zone &&
        !card.zoneOwner &&
        isRealAtlasCardImage(card.image) &&
        /battlefield-marker/i.test(card.classes)
      ) ?? cards.find((card) =>
        card.zone === zone &&
        !card.zoneOwner &&
        isRealAtlasCardImage(card.image)
      );
      return marker
        ? {
            text: usefulAtlasCardText(marker.text),
            image: marker.image,
            code: marker.code || cardCodeFromImage(marker.image),
            zone
          }
        : { ...emptyAtlasCard(), zone };
    })
    .filter((card) => card.image || card.code);
}

function isRealAtlasCardImage(value: string): boolean {
  return Boolean(cardCodeFromImage(value)) && !/cardback/i.test(value);
}

function usefulAtlasCardText(value: string): string {
  const text = value.trim();
  return /^(target|auto pay|[+-]?\d+\s*(buff|target)?)$/i.test(text) ? "" : text;
}

function readAtlasPlayers(bodyText: string, logRows: Array<{ text: string }>, readDomCandidates = true): { me: string; opponent: string; candidates: AtlasPlayerCandidate[] } {
  const sessionName = readAtlasSessionPlayerName();
  const candidates = readDomCandidates ? collectAtlasPlayerCandidates() : [];
  const domOpponent = chooseAtlasOpponentName(candidates, sessionName);
  if (sessionName || domOpponent) {
    return { me: sessionName, opponent: domOpponent, candidates };
  }
  const lines = [
    ...logRows.map((row) => row.text),
    bodyText.slice(0, MAX_TEXT)
  ].join("\n")
    .split(/[\n\r]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const chatNames = lines
    .map((line) => line.match(/^(.{1,48}?)\s+at\s+\d{1,2}:\d{2}\s*:/u)?.[1] ?? "")
    .map(cleanAtlasPlayerName)
    .filter((name) => name && !/^you$/i.test(name) && !isAtlasGenericName(name));
  const opponent = firstStableName(chatNames);
  if (opponent) {
    return { me: sessionName, opponent, candidates };
  }
  const turnNames = lines
    .map((line) => line.match(/^(.{1,48}?)['’]s turn\b/iu)?.[1] ?? "")
    .map(cleanAtlasPlayerName)
    .filter((name) => name && !isAtlasGenericName(name));
  return { me: sessionName, opponent: firstStableName(turnNames), candidates };
}

function readAtlasSessionPlayerName(): string {
  for (const key of ["riftbound_simulator_session", "riftbound_simulator_player_name"]) {
    try {
      const raw = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
      if (!raw) {
        continue;
      }
      if (raw.trim().startsWith("{")) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const name = cleanAtlasPlayerName(String(parsed.playerName ?? parsed.spectatorName ?? ""));
        if (name && !isAtlasGenericName(name)) {
          return name;
        }
        continue;
      }
      const name = cleanAtlasPlayerName(raw);
      if (name && !isAtlasGenericName(name)) {
        return name;
      }
    } catch {
      continue;
    }
  }
  return "";
}

function collectAtlasPlayerCandidates(): AtlasPlayerCandidate[] {
  const selectors = [
    "[data-player-name]",
    "[data-opponent-name]",
    "[data-username]",
    "[data-user-name]",
    "[data-name]",
    "[aria-label*='player' i]",
    "[aria-label*='opponent' i]",
    "[class*='player' i]",
    "[class*='opponent' i]",
    "[class*='identity' i]",
    "[class*='presence' i]",
    "[class*='name' i]",
    "[title]"
  ].join(", ");
  const byKey = new Map<string, AtlasPlayerCandidate>();
  for (const element of Array.from(document.querySelectorAll(selectors)).slice(0, 700)) {
    if (!isVisibleAtlasNameElement(element) || element.closest("[data-card-id], [data-drop-zone], [data-card-counter]")) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    const side = inferAtlasPlayerCandidateSide(element, rect);
    const sourceHint = atlasPlayerSourceHint(element);
    for (const raw of atlasPlayerCandidateValues(element)) {
      const name = cleanAtlasCandidateName(raw);
      if (!isLikelyAtlasPlayerName(name)) {
        continue;
      }
      const source = sourceHint || "dom";
      const score = atlasPlayerCandidateScore(element, source, side, raw);
      const key = normalizeNameKey(name);
      const existing = byKey.get(key);
      if (!existing || score > existing.score) {
        byKey.set(key, {
          name,
          side,
          source,
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          score
        });
      }
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function isVisibleAtlasNameElement(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) {
    return false;
  }
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0;
}

function atlasPlayerCandidateValues(element: Element): string[] {
  const values = [
    attr(element, "data-player-name"),
    attr(element, "data-opponent-name"),
    attr(element, "data-username"),
    attr(element, "data-user-name"),
    attr(element, "data-name"),
    attr(element, "aria-label"),
    attr(element, "title"),
    directTextOf(element),
    textOf(element)
  ];
  return values
    .flatMap((value) => value.split(/[\n\r|•·]+/))
    .map((value) => value.trim())
    .filter(Boolean);
}

function directTextOf(element: Element): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferAtlasPlayerCandidateSide(element: Element, rect: DOMRect): AtlasPlayerCandidate["side"] {
  const raw = [
    attr(element, "data-zone-owner"),
    attr(element, "data-owner"),
    attr(element, "data-player"),
    attr(element, "aria-label"),
    attr(element, "class"),
    attr(element.closest("[data-zone-owner]"), "data-zone-owner"),
    attr(element.closest("[data-owner]"), "data-owner"),
    attr(element.closest("[class*='opponent' i]"), "class"),
    attr(element.closest("[class*='player' i]"), "class")
  ].join(" ").toLowerCase();
  if (/\b(opponent|enemy|rival|away)\b/.test(raw)) {
    return "opponent";
  }
  if (/\b(self|me|mine|local|you|player)\b/.test(raw)) {
    return "me";
  }
  const midpoint = window.innerHeight / 2;
  if (rect.top + rect.height / 2 < midpoint * 0.9) {
    return "opponent";
  }
  if (rect.top + rect.height / 2 > midpoint * 1.1) {
    return "me";
  }
  return "unknown";
}

function atlasPlayerSourceHint(element: Element): string {
  const attrs = [
    "data-player-name",
    "data-opponent-name",
    "data-username",
    "data-user-name",
    "data-name",
    "aria-label",
    "title"
  ];
  const direct = attrs.find((name) => attr(element, name));
  if (direct) {
    return direct;
  }
  const classes = attr(element, "class").toLowerCase();
  if (/identity/.test(classes)) {
    return "identity-dom";
  }
  if (/presence/.test(classes)) {
    return "presence-dom";
  }
  if (/opponent/.test(classes)) {
    return "opponent-dom";
  }
  if (/player/.test(classes)) {
    return "player-dom";
  }
  return "";
}

function atlasPlayerCandidateScore(element: Element, source: string, side: AtlasPlayerCandidate["side"], raw: string): number {
  const classes = attr(element, "class").toLowerCase();
  let score = 1;
  if (/data-(player-name|opponent-name|username|user-name|name)/.test(source)) {
    score += 8;
  }
  if (/identity|presence|opponent|player|name/.test(classes) || /identity|presence|opponent|player/.test(source)) {
    score += 4;
  }
  if (side === "opponent") {
    score += 3;
  }
  if (side === "me") {
    score += 1;
  }
  if (/score|point|set .*score/i.test(raw)) {
    score -= 5;
  }
  if (element.children.length > 5) {
    score -= 2;
  }
  return score;
}

function cleanAtlasCandidateName(value: string): string {
  let text = cleanAtlasPlayerName(value)
    .replace(/^(opponent|player|you|me|name)\s*:?\s*/iu, "")
    .replace(/\b(is|are)?\s*(online|offline|connected|disconnected)\b.*$/iu, "")
    .replace(/\b(set|change|choose|select)\b.*$/iu, "")
    .replace(/\b(score|points?|turn|deck|cards?|hand|base|battlefield)\b.*$/iu, "")
    .replace(/\s+\d{1,2}\s*$/u, "")
    .trim();
  if (text.includes(":")) {
    text = text.split(":").pop()?.trim() ?? text;
  }
  return cleanAtlasPlayerName(text).slice(0, 48);
}

function isLikelyAtlasPlayerName(value: string): boolean {
  const name = cleanAtlasPlayerName(value);
  if (!name || name.length > 36 || /^\d+$/.test(name)) {
    return false;
  }
  const key = normalizeNameKey(name);
  if (isAtlasGenericName(name) || BATTLEFIELD_NAMES.some((item) => normalizeNameKey(item.name) === key || normalizeNameKey(item.canonical) === key)) {
    return false;
  }
  if (/^(unl|ogn|sfd|pro)-\d{3}[a-z]?$/i.test(name)) {
    return false;
  }
  if (/\b(score|points?|battlefield|mulligan|sideboard|deck|hand|base|rune|energy|power|turn|room|match|lobby|play|pass|concede|report|winner|victory|defeat|support|tcg|atlas)\b/i.test(name)) {
    return false;
  }
  return true;
}

function chooseAtlasOpponentName(candidates: AtlasPlayerCandidate[], localName: string): string {
  const localKey = normalizeNameKey(localName);
  const usable = candidates.filter((candidate) => {
    const key = normalizeNameKey(candidate.name);
    return key && key !== localKey && candidate.score >= 3;
  });
  return usable.find((candidate) => candidate.side === "opponent")?.name ?? (usable.length === 1 ? usable[0].name : "");
}

function cleanAtlasPlayerName(value: string): string {
  return value
    .replace(/^[^\p{L}\p{N}_]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstStableName(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) {
    const cleaned = name.trim();
    counts.set(cleaned, (counts.get(cleaned) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function isAtlasGenericName(value: string): boolean {
  return /^(turn|room|chain|target|send|leave|stay|confirm|rewind|next game|auto pay|no card|rune deck)$/i.test(value.trim());
}

function readAtlasBattlefieldCard(owner: "player" | "opponent"): { text: string; image: string; code: string } {
  const selectors = [
    `[data-zone-owner="${owner}"] [data-drop-zone*="battlefield" i]`,
    `[data-zone-owner="${owner}"] [data-drop-zone*="battle" i]`,
    `[data-owner="${owner}"] [data-drop-zone*="battlefield" i]`,
    `[data-owner="${owner}"] [data-drop-zone*="battle" i]`,
    `[class*="${owner}" i] [class*="battlefield" i]`,
    `[class*="${owner}" i] [class*="battle" i]`
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) {
      continue;
    }
    const img = element.querySelector("img") as HTMLImageElement | null;
    const image = img?.currentSrc || img?.src || attr(img, "data-src") || attr(img, "alt");
    const code = attr(element, "data-card-id") || attr(img, "data-card-id") || cardCodeFromImage(image);
    const text = textOf(element);
    if (text || image || code) {
      return { text, image, code };
    }
  }
  return { text: "", image: "", code: "" };
}

function atlasBattlefieldCandidate(side: BattlefieldCandidate["side"], card: { text: string; image: string; code: string }): BattlefieldCandidate {
  return {
    side,
    image: card.image,
    code: card.code,
    text: card.text.slice(0, 180),
    classes: "atlas-battlefield",
    hidden: false,
    capturedAt: now()
  };
}

function readRoomCode(bodyText: string): string {
  const labelled = bodyText.match(/room\s*code\s*:?\s*([a-z0-9-]{3,16})/i);
  return labelled?.[1] ?? "";
}

function findBattlefieldText(owner: "player" | "opponent"): string {
  const selectors = [
    `[data-zone-owner="${owner}"] [data-drop-zone*="battlefield" i]`,
    `[data-zone-owner="${owner}"] [data-drop-zone*="battle" i]`,
    `[data-owner="${owner}"] [data-drop-zone*="battlefield" i]`,
    `[data-owner="${owner}"] [data-drop-zone*="battle" i]`,
    `[class*="${owner}" i] [class*="battlefield" i]`
  ];
  for (const selector of selectors) {
    const value = textOf(document.querySelector(selector));
    if (value) {
      return value;
    }
  }
  return "";
}

function findText(pattern: RegExp): string {
  const candidates = Array.from(document.querySelectorAll("button, a, h1, h2, h3, [class*='modal'], [class*='dialog'], [class*='result']"));
  for (const candidate of candidates) {
    const value = textOf(candidate);
    if (value && pattern.test(value)) {
      return value;
    }
  }
  return "";
}

function selectorCount(selector: string): number {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

function debugSnapshot(): Record<string, unknown> {
  const bodyText = documentText(2000);
  return {
    title: document.title,
    readyState: document.readyState,
    visibility: document.visibilityState,
    focused: document.hasFocus(),
    bodyTextLength: bodyText.length,
    path: location.pathname,
    hash: location.hash,
    storageKeys: safeStorageKeys(),
    selectorCounts: {
      tcgaCounters: selectorCount(".PLAYER-COUNTER, .player-counters-wrapper"),
      gameCards: selectorCount(".game-card"),
      atlasCards: selectorCount("[data-card-id]"),
      dropZones: selectorCount("[data-drop-zone]"),
      zoneOwners: selectorCount("[data-zone-owner]"),
      logRows: selectorCount("ul li, [role='log'] li, [class*='log' i] li, [class*='matchLog' i] li"),
      modals: selectorCount("[class*='modal' i], [class*='dialog' i], [role='dialog']")
    }
  };
}

function safeStorageKeys(): string[] {
  try {
    return Array.from({ length: localStorage.length }, (_item, index) => localStorage.key(index) ?? "").filter(Boolean).slice(0, 80);
  } catch {
    return [];
  }
}

function snapshot(): Record<string, unknown> {
  return platform === "tcga" ? readTcgaSnapshot() : readAtlasSnapshot();
}

function scheduleSnapshot(reason: string): void {
  if (snapshotTimer) {
    window.clearTimeout(snapshotTimer);
  }
  snapshotTimer = window.setTimeout(() => publishSnapshot(reason), SNAPSHOT_DEBOUNCE_MS);
}

function publishSnapshot(reason: string): void {
  const current = Date.now();
  const forceReason = reason === "initial" || reason === "safety-heartbeat";
  if (!forceReason && current - lastSnapshotPublishedAt < SNAPSHOT_DEBOUNCE_MS) {
    scheduleSnapshot(reason);
    return;
  }
  lastSnapshotPublishedAt = current;
  const data = snapshot();
  const active = Boolean(data.active);
  const endText = typeof data.endText === "string" ? data.endText.trim() : "";
  const visibleResultKey = endText ? normalizeVisibleResultKey(endText) : "";
  if (!active || !visibleResultKey) {
    endedVisibleResultKey = "";
    lastEndSignature = "";
  }
  const alreadyEndedVisibleResult = Boolean(active && visibleResultKey && endedVisibleResultKey === visibleResultKey);
  const signature = JSON.stringify({
    active,
    score: data.score,
    myName: data.myName,
    opponentName: data.opponentName,
    myChampion: data.myChampion || data.myChampionImage,
    opponentChampion: data.opponentChampion || data.opponentChampionImage,
    myBattlefield: data.myBattlefield || data.myBattlefieldImage,
    opponentBattlefield: data.opponentBattlefield || data.opponentBattlefieldImage,
    turnText: data.turnText,
    tcgaPhase: data.tcgaPhase,
    tcgaCardZoneOverlay: data.tcgaCardZoneOverlay,
    deckTrackerCards: cardSnapshotSignature(data.deckTrackerCards),
    endText: data.endText
  });

  if (active && !previousActive && !alreadyEndedVisibleResult && !visibleResultKey) {
    if (endTimer) {
      window.clearTimeout(endTimer);
      endTimer = undefined;
    }
    previousActive = true;
    send("match-start", { ...data, reason });
  }

  if (active && endTimer && !alreadyEndedVisibleResult) {
    window.clearTimeout(endTimer);
    endTimer = undefined;
    send("match-update", { ...data, reason: "active-returned" });
  }

  if (active) {
    lastActiveSnapshot = { ...lastActiveSnapshot, ...data };
  }

  if (active && endText) {
    const endSignature = `${location.host}:${visibleResultKey}`;
    if (visibleResultKey && visibleResultKey !== endedVisibleResultKey && endSignature !== lastEndSignature) {
      lastEndSignature = endSignature;
      endedVisibleResultKey = visibleResultKey;
      previousActive = false;
      send("match-end", { ...lastActiveSnapshot, ...data, reason: "result-text-detected" });
      lastActiveSnapshot = {};
    }
  }

  if (!active && previousActive && !endTimer) {
    endTimer = window.setTimeout(() => {
      const finalSnapshot = snapshot();
      if (!finalSnapshot.active) {
        previousActive = false;
        send("match-end", { ...lastActiveSnapshot, ...data, ...finalSnapshot, reason: "inactive-debounce" });
        lastActiveSnapshot = {};
      }
      endTimer = undefined;
    }, platform === "atlas" ? 1800 : 3000);
  }

  if (signature !== lastSnapshotSignature) {
    lastSnapshotSignature = signature;
    sendDebug("snapshot-signature-changed", { active, signatureLength: signature.length });
    send("match-snapshot", { ...data, reason });
  }
}

function normalizeVisibleResultKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 500);
}

function atlasInteractionIsQuiet(): boolean {
  return platform === "atlas" && Date.now() < atlasInteractionQuietUntil;
}

function markAtlasInteraction(delay = ATLAS_INTERACTION_QUIET_MS): void {
  if (platform !== "atlas") {
    return;
  }
  atlasInteractionQuietUntil = Date.now() + delay;
  if (atlasInteractionSettleTimer) {
    window.clearTimeout(atlasInteractionSettleTimer);
  }
  atlasInteractionSettleTimer = window.setTimeout(() => {
    if (atlasDeferredMutationSnapshot) {
      atlasDeferredMutationSnapshot = false;
      scheduleSnapshot("interaction-settled");
    }
  }, delay + 150);
}

function installAtlasInteractionThrottle(): void {
  if (platform !== "atlas") {
    return;
  }
  const active = () => markAtlasInteraction();
  const settling = () => markAtlasInteraction(250);
  window.addEventListener("pointerdown", active, { capture: true, passive: true });
  window.addEventListener("pointermove", active, { capture: true, passive: true });
  window.addEventListener("dragstart", active, { capture: true });
  window.addEventListener("dragover", active, { capture: true, passive: true });
  window.addEventListener("touchmove", active, { capture: true, passive: true });
  window.addEventListener("pointerup", settling, { capture: true, passive: true });
  window.addEventListener("pointercancel", settling, { capture: true, passive: true });
  window.addEventListener("drop", settling, { capture: true });
}

function mutationText(mutation: MutationRecord): string {
  const target = mutation.target as Element;
  const targetText = `${target.nodeName} ${target.id ?? ""} ${target.className ?? ""}`;
  const addedText = Array.from(mutation.addedNodes)
    .slice(0, 6)
    .map((node) => {
      if (!(node instanceof Element)) {
        return node.nodeName;
      }
      return `${node.nodeName} ${node.id ?? ""} ${node.className ?? ""} ${textOf(node).slice(0, 80)}`;
    })
    .join(" ");
  return `${targetText} ${addedText}`;
}

function isMeaningfulDomMutation(mutation: MutationRecord): boolean {
  const haystack = mutationText(mutation);
  if (platform === "atlas") {
    if (/modal|dialog|result|winner|victory|defeat|concede|report|toast|log|history|score|track|counter|mulligan|sideboard|turn|battlefield/i.test(haystack)) {
      return true;
    }
    if (/card|zone|drop|drag|sortable|piece|token/i.test(haystack)) {
      return !atlasInteractionIsQuiet();
    }
    return /game|battle/i.test(haystack);
  }
  return /PLAYER-COUNTER|log|game|battle|card|modal|dialog|result|zone|drop/i.test(haystack);
}

function installDomObserver(): void {
  const start = () => {
    if (!document.body) {
      window.setTimeout(start, 100);
      return;
    }
    installAtlasInteractionThrottle();
    const observer = new MutationObserver((mutations) => {
      if (platform === "atlas" && atlasInteractionIsQuiet()) {
        const critical = mutations.some((mutation) =>
          /modal|dialog|result|winner|victory|defeat|concede|report|toast|log|history|score|track|counter|mulligan|sideboard|turn|battlefield/i.test(mutationText(mutation))
        );
        if (!critical) {
          atlasDeferredMutationSnapshot = true;
          return;
        }
      }
      const meaningful = mutations.some(isMeaningfulDomMutation);
      if (meaningful) {
        const current = Date.now();
        if (current - lastDebugMutationAt > 3000) {
          lastDebugMutationAt = current;
          sendDebug("meaningful-dom-mutation", {
            mutationCount: mutations.length,
            mutationTargets: mutations.slice(0, 12).map((mutation) => {
              const target = mutation.target as Element;
              return {
                type: mutation.type,
                node: target.nodeName,
                id: target.id ?? "",
                classes: String(target.className ?? "").slice(0, 160)
              };
            })
          });
        }
        scheduleSnapshot("mutation");
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    send("capture-ready", { mode: "dom-observer", host: location.host });
    sendDebug("capture-ready-debug");
    publishSnapshot("initial");
    const heartbeat = () => {
      publishSnapshot("safety-heartbeat");
      window.setTimeout(heartbeat, previousActive ? ACTIVE_HEARTBEAT_MS : IDLE_HEARTBEAT_MS);
    };
    window.setTimeout(heartbeat, ACTIVE_HEARTBEAT_MS);
    window.setInterval(() => sendDebug("debug-heartbeat"), 15000);
  };
  start();
}

function installNetworkHooks(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    const requestUrl = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : "";
    if (INTERESTING_URL.test(requestUrl)) {
      void response
        .clone()
        .text()
        .then((text) => {
          const body = safeJson(text);
          send("network-fetch", {
            requestUrl,
            status: response.status,
            contentType: response.headers.get("content-type") ?? "",
            body,
            score: scoreFromUnknown(body)
          });
          sendDebug("network-fetch-debug", { requestUrl, status: response.status });
          scheduleSnapshot("fetch");
        })
        .catch(() => undefined);
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function open(method: string, url: string | URL, ...rest: unknown[]) {
    this.__riftliteUrl = String(url);
    return Reflect.apply(originalOpen, this, [method, url, ...rest]) as void;
  };
  XMLHttpRequest.prototype.send = function sendPatched(...args: unknown[]) {
    this.addEventListener("load", function onLoad() {
      const requestUrl = this.__riftliteUrl ?? "";
      if (!INTERESTING_URL.test(requestUrl)) {
        return;
      }
      send("network-xhr", {
        requestUrl,
        status: this.status,
        responseText: safeJson(String(this.responseText ?? "").slice(0, MAX_TEXT)),
        score: scoreFromUnknown(safeJson(String(this.responseText ?? "").slice(0, MAX_TEXT)))
      });
      sendDebug("network-xhr-debug", { requestUrl, status: this.status });
      scheduleSnapshot("xhr");
    });
    return originalSend.apply(this, args as []);
  };

  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = class RiftLiteWebSocket extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      if (protocols === undefined) {
        super(url);
      } else {
        super(url, protocols);
      }
      this.addEventListener("message", (message) => {
        const raw = websocketMessageText(message.data);
        const shouldCapture = raw && (
          INTERESTING_URL.test(String(url) + raw.slice(0, 500)) ||
          (platform === "atlas" && /score|points?|battlefield|players?|turnPlayer|roomCode|victoryScore/i.test(raw.slice(0, MAX_TEXT)))
        );
        if (shouldCapture) {
          const body = safeJson(raw.slice(0, MAX_TEXT));
          send("network-websocket", {
            requestUrl: String(url),
            body,
            score: scoreFromUnknown(body)
          });
          sendDebug("network-websocket-debug", { requestUrl: String(url) });
          scheduleSnapshot("websocket");
        }
      });
    }
  };
}

function websocketMessageText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    try {
      return new TextDecoder().decode(value);
    } catch {
      return "";
    }
  }
  if (ArrayBuffer.isView(value)) {
    try {
      return new TextDecoder().decode(value);
    } catch {
      return "";
    }
  }
  return "";
}

function installDebugCapture(): void {
  const refreshDebugMode = () => {
    void ipcRenderer.invoke("capture:debug-enabled")
      .then((enabled) => {
        const next = enabled === true;
        if (next !== debugEnabled) {
          debugEnabled = next;
          sendDebug("debug-mode-enabled");
        } else {
          debugEnabled = next;
        }
      })
      .catch(() => undefined);
  };
  refreshDebugMode();
  window.setInterval(refreshDebugMode, DEBUG_MODE_REFRESH_MS);

  window.addEventListener("error", (event) => {
    sendDebug("window-error", {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    sendDebug("unhandled-rejection", { reasonText: String(event.reason ?? "").slice(0, MAX_TEXT) });
  });
  for (const eventName of ["visibilitychange", "focus", "blur", "hashchange", "popstate"]) {
    window.addEventListener(eventName, () => sendDebug(`page-${eventName}`));
  }

  const originalPushState = history.pushState.bind(history);
  history.pushState = (...args: Parameters<History["pushState"]>) => {
    const result = originalPushState(...args);
    sendDebug("history-push-state", { nextUrl: String(args[2] ?? "") });
    scheduleSnapshot("history-push-state");
    return result;
  };
  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    const result = originalReplaceState(...args);
    sendDebug("history-replace-state", { nextUrl: String(args[2] ?? "") });
    scheduleSnapshot("history-replace-state");
    return result;
  };
}

declare global {
  interface XMLHttpRequest {
    __riftliteUrl?: string;
  }
}

installNetworkHooks();
installDebugCapture();
installDomObserver();
