import { createServer, type Server } from "node:http";
import { app } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MatchDraft, OverlayDisplayOptions, SavedDeck, UserSettings } from "../../shared/types.js";
import { activeDeckOverlayStats, buildDeckPerformance } from "../../shared/deckPerformance.js";
import { normalizeLegendName } from "../../shared/legendNames.js";
import { RiftLiteStore } from "./store.js";

const OVERLAY_PORT = 17731;
const OVERLAY_HOST = "127.0.0.1";
const MAX_PORT_ATTEMPTS = 20;
const OVERLAY_TEXT_REFRESH_MS = 2000;
const OVERLAY_STATS_CACHE_MS = 5000;
const OVERLAY_TEXT_FILES = {
  liveSummary: "live-summary.txt",
  matchup: "matchup.txt",
  score: "score.txt",
  myLegend: "my-legend.txt",
  opponentLegend: "opponent-legend.txt",
  opponentName: "opponent-name.txt",
  battlefields: "battlefields.txt",
  myBattlefield: "my-battlefield.txt",
  opponentBattlefield: "opponent-battlefield.txt",
  platform: "platform.txt",
  status: "status.txt",
  latestResult: "latest-result.txt",
  sessionRecord: "session-record.txt",
  sessionSummary: "session-summary.txt",
  activeDeck: "active-deck.txt"
} as const;
type OverlayLayout = "landscape" | "portrait";
type OverlayTextFileKey = keyof typeof OVERLAY_TEXT_FILES;

export class OverlayServer {
  private server: Server | null = null;
  private currentPort = OVERLAY_PORT;
  private textOutputTimer: ReturnType<typeof setInterval> | null = null;
  private writingTextOutputs = false;
  private readonly lastTextValues: Partial<Record<OverlayTextFileKey, string>> = {};
  private statsCache: {
    expiresAt: number;
    matches: MatchDraft[];
    settings: UserSettings;
    activeDeck: SavedDeck | null;
  } | null = null;

  constructor(
    private readonly store: RiftLiteStore,
    private readonly liveMatchProvider: () => Record<string, unknown> | null = () => null
  ) {}

  get url(): string {
    return this.landscapeUrl;
  }

  get landscapeUrl(): string {
    const port = this.port;
    return `http://${OVERLAY_HOST}:${port}/overlay/landscape`;
  }

  get portraitUrl(): string {
    const port = this.port;
    return `http://${OVERLAY_HOST}:${port}/overlay/portrait`;
  }

  get port(): number {
    const address = this.server?.address();
    return typeof address === "object" && address ? address.port : this.currentPort;
  }

  get textOutputDirectory(): string {
    return overlayTextOutputDirectory();
  }

  get textFiles(): Record<OverlayTextFileKey, string> {
    return overlayTextFilePaths(this.textOutputDirectory);
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }
    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt += 1) {
      const port = OVERLAY_PORT + attempt;
      const server = this.createServer();
      try {
        await listen(server, port);
        this.server = server;
        this.currentPort = port;
        this.startTextOutputLoop();
        return;
      } catch (error) {
        server.close();
        if (isAddressInUse(error)) {
          continue;
        }
        console.warn("RiftLite overlay server did not start", error);
        return;
      }
    }
    console.warn(`RiftLite overlay server could not find a free port from ${OVERLAY_PORT} to ${OVERLAY_PORT + MAX_PORT_ATTEMPTS - 1}`);
  }

  stop(): void {
    if (this.textOutputTimer) {
      clearInterval(this.textOutputTimer);
      this.textOutputTimer = null;
    }
    this.server?.close();
    this.server = null;
  }

  private createServer(): Server {
    return createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", `http://${OVERLAY_HOST}:${this.port}`);
      if (url.pathname === "/overlay/data.json") {
        const payload = await this.buildPayload();
        response.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        response.end(JSON.stringify(payload));
        return;
      }
      if (url.pathname === "/overlay" || url.pathname === "/overlay/landscape" || url.pathname === "/overlay/portrait") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        response.end(overlayHtml(readOverlayLayout(url)));
        return;
      }
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    });
  }

  private startTextOutputLoop(): void {
    if (this.textOutputTimer) {
      return;
    }
    this.textOutputTimer = setInterval(() => {
      void this.writeTextOutputs().catch((error) => {
        console.warn("RiftLite overlay text outputs did not update", error);
      });
    }, OVERLAY_TEXT_REFRESH_MS);
    void this.writeTextOutputs().catch((error) => {
      console.warn("RiftLite overlay text outputs did not initialize", error);
    });
  }

  private async writeTextOutputs(): Promise<void> {
    if (this.writingTextOutputs) {
      return;
    }
    this.writingTextOutputs = true;
    try {
      await writeOverlayTextFiles(this.textOutputDirectory, await this.buildPayload(), this.lastTextValues);
    } finally {
      this.writingTextOutputs = false;
    }
  }

  private async buildPayload(): Promise<Record<string, unknown>> {
    const { matches, settings, activeDeck } = await this.cachedStatsData();
    const sessionStart = overlaySessionStart(settings.overlaySessionStartedAt);
    const activeDeckStats = activeDeck ? activeDeckOverlayStats(buildDeckPerformance(activeDeck, matches, sessionStart.date), sessionStart.date) : null;
    const completed = matches.filter(isCompletedMatch);
    const session = completed.filter((match) => matchCapturedAfter(match, sessionStart.date));
    const latest = matches[0];
    const latestMyLegend = latest ? normalizeLegendName(latest.myChampion) : "";
    const latestOpponentLegend = latest ? normalizeLegendName(latest.opponentChampion) : "";
    const legendMatches = latestMyLegend
      ? completed.filter((match) => normalizeLegendName(match.myChampion) === latestMyLegend)
      : [];
    const matchupMatches = latestMyLegend && latestOpponentLegend
      ? completed.filter((match) => normalizeLegendName(match.myChampion) === latestMyLegend && normalizeLegendName(match.opponentChampion) === latestOpponentLegend)
      : [];
    return {
      updatedAt: new Date().toISOString(),
      display: overlayDisplay(settings.overlayDisplay),
      session: {
        ...statBlock(session),
        startedAt: sessionStart.date.toISOString(),
        reset: sessionStart.reset
      },
      live: this.liveMatchProvider(),
      latest: latest ? publicMatch(latest) : null,
      legendStats: statBlock(legendMatches),
      matchupStats: statBlock(matchupMatches),
      activeDeckStats
    };
  }

  private async cachedStatsData(): Promise<{ matches: MatchDraft[]; settings: UserSettings; activeDeck: SavedDeck | null }> {
    const now = Date.now();
    if (this.statsCache && this.statsCache.expiresAt > now) {
      return this.statsCache;
    }
    const settings = await this.store.getSettings();
    const [matches, activeDeck] = await Promise.all([
      this.store.getMatches(),
      settings.activeDeckId ? this.store.getSavedDeck(settings.activeDeckId) : Promise.resolve(null)
    ]);
    this.statsCache = {
      expiresAt: now + OVERLAY_STATS_CACHE_MS,
      matches,
      settings,
      activeDeck
    };
    return this.statsCache;
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, OVERLAY_HOST);
  });
}

function isAddressInUse(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EADDRINUSE");
}

function readOverlayLayout(url: URL): OverlayLayout {
  if (url.pathname.endsWith("/portrait") || url.searchParams.get("layout") === "portrait") {
    return "portrait";
  }
  return "landscape";
}

function isCompletedMatch(match: MatchDraft): boolean {
  return match.result === "Win" || match.result === "Loss" || match.result === "Draw";
}

function matchCapturedAfter(match: MatchDraft, start: Date): boolean {
  const captured = new Date(match.capturedAt);
  return Number.isNaN(captured.getTime()) ? false : captured >= start;
}

function overlaySessionStart(value: string): { date: Date; reset: boolean } {
  const resetDate = new Date(value);
  if (value && !Number.isNaN(resetDate.getTime())) {
    return { date: resetDate, reset: true };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { date: today, reset: false };
}

function overlayDisplay(display: Partial<OverlayDisplayOptions> | undefined): OverlayDisplayOptions {
  return {
    profile: display?.profile ?? "grind",
    showBranding: true,
    showWebsite: display?.showWebsite !== false,
    showSession: display?.showSession !== false,
    showLatestMatch: display?.showLatestMatch !== false,
    showResult: display?.showResult !== false,
    showOpponentName: display?.showOpponentName !== false,
    showScore: display?.showScore !== false,
    showPlatform: display?.showPlatform !== false,
    showDeck: display?.showDeck !== false,
    showLegendWinRate: display?.showLegendWinRate !== false,
    showMatchupWinRate: display?.showMatchupWinRate !== false,
    showActiveDeckStats: display?.showActiveDeckStats === true,
    showDeckSessionStats: display?.showDeckSessionStats !== false,
    showDeckMatchups: display?.showDeckMatchups !== false,
    showFooter: display?.showFooter !== false
  };
}

function statBlock(matches: MatchDraft[]): Record<string, unknown> {
  const wins = matches.filter((match) => match.result === "Win").length;
  const losses = matches.filter((match) => match.result === "Loss").length;
  const draws = matches.filter((match) => match.result === "Draw").length;
  const decisive = wins + losses;
  const record = `${wins}-${losses}${draws ? `-${draws}` : ""}`;
  return {
    total: matches.length,
    wins,
    losses,
    draws,
    winRate: decisive ? Math.round((wins / decisive) * 100) : 0,
    record
  };
}

function publicMatch(match: MatchDraft): Record<string, unknown> {
  return {
    myName: match.myName,
    result: match.result,
    platform: match.platform,
    opponentName: match.opponentName,
    myChampion: normalizeLegendName(match.myChampion),
    opponentChampion: normalizeLegendName(match.opponentChampion),
    myBattlefield: match.myBattlefield,
    opponentBattlefield: match.opponentBattlefield,
    deckName: match.deckName,
    score: match.score,
    capturedAt: match.capturedAt
  };
}

function overlayTextOutputDirectory(): string {
  return join(app.getPath("userData"), "overlay-text");
}

function overlayTextFilePaths(directory: string): Record<OverlayTextFileKey, string> {
  return Object.fromEntries(
    Object.entries(OVERLAY_TEXT_FILES).map(([key, filename]) => [key, join(directory, filename)])
  ) as Record<OverlayTextFileKey, string>;
}

async function writeOverlayTextFiles(
  directory: string,
  payload: Record<string, unknown>,
  previous: Partial<Record<OverlayTextFileKey, string>> = {}
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const files = overlayTextFilePaths(directory);
  const text = overlayTextValues(payload);
  await Promise.all(
    Object.entries(files)
      .filter(([key]) => previous[key as OverlayTextFileKey] !== (text[key as OverlayTextFileKey] ?? ""))
      .map(async ([key, filePath]) => {
        const textKey = key as OverlayTextFileKey;
        const value = text[textKey] ?? "";
        await writeFile(filePath, `${value}\n`, "utf8");
        previous[textKey] = value;
      })
  );
}

function overlayTextValues(payload: Record<string, unknown>): Record<OverlayTextFileKey, string> {
  const live = objectValue(payload.live);
  const latest = objectValue(payload.latest);
  const source = live ?? latest;
  const session = objectValue(payload.session);
  const activeDeckStats = objectValue(payload.activeDeckStats);
  const isLive = Boolean(live);
  const myLegend = textValue(source?.myChampion);
  const opponentLegend = textValue(source?.opponentChampion);
  const opponentName = textValue(source?.opponentName);
  const score = textValue(source?.score);
  const myBattlefield = textValue(source?.myBattlefield);
  const opponentBattlefield = textValue(source?.opponentBattlefield);
  const platform = textValue(source?.platform);
  const matchup = joinVs(myLegend, opponentLegend);
  const battlefields = joinVs(myBattlefield, opponentBattlefield);
  const sessionRecord = textValue(session?.record);
  const sessionTotal = textValue(session?.total);
  const activeDeck = [textValue(activeDeckStats?.title), textValue(activeDeckStats?.record), textValue(activeDeckStats?.winRate)]
    .filter(Boolean)
    .join(" | ");
  return {
    liveSummary: summaryLine(isLive, matchup, score, battlefields, latest),
    matchup,
    score,
    myLegend,
    opponentLegend,
    opponentName,
    battlefields,
    myBattlefield,
    opponentBattlefield,
    platform,
    status: isLive ? "Live match" : latest ? "Latest match" : "Waiting for match",
    latestResult: latest ? [textValue(latest.result), textValue(latest.score)].filter(Boolean).join(" ") : "",
    sessionRecord,
    sessionSummary: sessionRecord ? `${sessionRecord}${sessionTotal ? ` (${sessionTotal} matches)` : ""}` : "",
    activeDeck
  };
}

function summaryLine(
  isLive: boolean,
  matchup: string,
  score: string,
  battlefields: string,
  latest: Record<string, unknown> | null
): string {
  const parts = [matchup, score, battlefields].filter(Boolean);
  if (parts.length) {
    return `${isLive ? "Live" : "Latest"}: ${parts.join(" | ")}`;
  }
  if (latest) {
    return "Latest match available";
  }
  return "Waiting for match";
}

function joinVs(left: string, right: string): string {
  if (left && right) {
    return `${left} vs ${right}`;
  }
  return left || right || "";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function overlayHtml(layout: OverlayLayout): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RiftLite Overlay</title>
  <style>
    :root { font-family: Inter, Segoe UI, sans-serif; color: #f4f8ff; background: transparent; }
    body { margin: 0; background: transparent; }
    [hidden] { display: none !important; }
    .overlay {
      overflow: hidden;
      border: 1px solid rgba(40, 215, 255, .52);
      border-radius: 8px;
      background:
        linear-gradient(135deg, rgba(40, 215, 255, .18), transparent 36%),
        linear-gradient(315deg, rgba(157, 53, 255, .18), transparent 42%),
        rgba(11, 15, 24, .91);
      box-shadow: 0 18px 50px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.08);
    }
    body.landscape .overlay {
      width: 760px;
      min-height: 164px;
      padding: 14px 16px;
      display: grid;
      grid-template-columns: 145px 118px minmax(0, 1fr) 220px;
      gap: 14px;
      align-items: stretch;
    }
    body.portrait .overlay {
      width: 310px;
      min-height: 438px;
      padding: 15px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    body.landscape.profile-compact .overlay {
      width: 560px;
      min-height: 118px;
      padding: 12px 14px;
    }
    body.landscape.profile-deck-focused .overlay {
      width: 860px;
    }
    body.landscape.profile-compact .score {
      font-size: 34px;
    }
    body.landscape.profile-compact .match strong {
      font-size: 18px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    body.landscape .brand {
      flex-direction: column;
      align-items: flex-start;
      justify-content: space-between;
      padding-right: 12px;
      border-right: 1px solid rgba(255,255,255,.1);
    }
    .brand-mark {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border-radius: 8px;
      color: #ffffff;
      font-weight: 950;
      font-size: 25px;
      background: linear-gradient(135deg, #1f74ff, #28d7ff 48%, #9d35ff);
      box-shadow: 0 0 24px rgba(40, 215, 255, .34), 0 0 30px rgba(157, 53, 255, .22);
    }
    .brand strong,
    .brand span {
      display: block;
      white-space: nowrap;
    }
    .brand strong {
      font-size: 18px;
      font-weight: 900;
      color: #f4f8ff;
    }
    .brand span {
      margin-top: 2px;
      color: #8cecff;
      font-size: 12px;
      font-weight: 800;
    }
    .session {
      display: grid;
      align-content: center;
      gap: 4px;
    }
    .eyebrow, .label, em {
      color: #9ba8ba;
      font-size: 11px;
      font-style: normal;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .score {
      color: #f4f8ff;
      font-size: 42px;
      font-weight: 950;
      line-height: .95;
      text-shadow: 0 0 18px rgba(40, 215, 255, .26);
    }
    .match {
      min-width: 0;
      display: grid;
      align-content: center;
      gap: 8px;
    }
    .result {
      width: max-content;
      max-width: 100%;
      padding: 4px 9px;
      border: 1px solid rgba(140, 236, 255, .34);
      border-radius: 999px;
      color: #8cecff;
      background: rgba(40, 215, 255, .1);
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .live-pill {
      width: max-content;
      max-width: 100%;
      padding: 5px 9px;
      border: 1px solid rgba(255, 75, 124, .46);
      border-radius: 999px;
      color: #ffffff;
      background: linear-gradient(135deg, rgba(255, 75, 124, .42), rgba(40, 215, 255, .2));
      box-shadow: 0 0 16px rgba(255, 75, 124, .18);
      font-size: 11px;
      font-weight: 950;
      text-transform: uppercase;
    }
    .match strong {
      display: block;
      overflow: hidden;
      color: #ffffff;
      font-size: 20px;
      font-weight: 900;
      line-height: 1.08;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    body.portrait .match strong {
      white-space: normal;
      font-size: 23px;
    }
    .match span {
      display: block;
      overflow: hidden;
      color: #cbd6e6;
      font-size: 12px;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    body.portrait .match span {
      white-space: normal;
    }
    .stats {
      display: grid;
      gap: 8px;
    }
    body.landscape .stats {
      align-content: center;
    }
    .stat {
      padding: 10px;
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 8px;
      background: rgba(18, 24, 35, .72);
    }
    .stat strong {
      display: block;
      margin-top: 3px;
      color: #8cecff;
      font-size: 23px;
      font-weight: 950;
    }
    .stat span {
      color: #cbd6e6;
      font-size: 11px;
      font-weight: 750;
    }
    .deck-stats {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    body.portrait .deck-stats {
      grid-template-columns: 1fr;
    }
    .deck-chip {
      min-width: 0;
      padding: 9px 10px;
      border: 1px solid rgba(140, 236, 255, .18);
      border-radius: 8px;
      background: rgba(7, 16, 32, .74);
    }
    .deck-chip strong,
    .deck-chip span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .deck-chip strong {
      margin-top: 3px;
      color: #f4f8ff;
      font-size: 14px;
      font-weight: 900;
    }
    .deck-chip span {
      color: #8cecff;
      font-size: 12px;
      font-weight: 850;
    }
    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: #778399;
      font-size: 10px;
      font-weight: 800;
    }
    body.landscape .footer {
      grid-column: 1 / -1;
      margin-top: -4px;
    }
  </style>
</head>
<body class="${layout}">
  <section class="overlay">
    <header id="brandSection" class="brand">
      <div class="brand-mark">R</div>
      <div>
        <strong>RiftLite</strong>
        <span id="websiteText">RiftLite.com</span>
      </div>
    </header>
    <section id="sessionSection" class="session">
      <span class="eyebrow">Current session</span>
      <strong id="sessionRecord" class="score">0-0</strong>
      <em id="sessionMeta">0 matches today</em>
    </section>
    <section id="matchSection" class="match">
      <span id="livePill" class="live-pill" hidden>Live match</span>
      <span id="resultPill" class="result">Waiting</span>
      <strong id="matchup">Waiting for captured match</strong>
      <span id="matchMeta">Capture starts automatically</span>
      <span id="deckName">Deck pending</span>
    </section>
    <section id="statsSection" class="stats">
      <div id="legendStat" class="stat">
        <span class="label">Legend WR</span>
        <strong id="legendWr">Pending</strong>
        <span id="legendRecord">0 matches</span>
      </div>
      <div id="matchupStat" class="stat">
        <span class="label">Into opponent</span>
        <strong id="matchupWr">Pending</strong>
        <span id="matchupRecord">0 matches</span>
      </div>
    </section>
    <section id="deckStatsSection" class="deck-stats">
      <div class="deck-chip">
        <span class="label">Active deck</span>
        <strong id="activeDeckTitle">No active deck</strong>
        <span id="activeDeckMeta">Set one from Decks</span>
      </div>
      <div class="deck-chip">
        <span class="label">Deck record</span>
        <strong id="activeDeckRecord">0-0</strong>
        <span id="activeDeckWr">No matches</span>
      </div>
      <div id="activeDeckSessionChip" class="deck-chip">
        <span class="label">Deck session</span>
        <strong id="activeDeckSession">0-0</strong>
        <span>since reset</span>
      </div>
      <div id="activeDeckMatchupChip" class="deck-chip">
        <span class="label">Matchups</span>
        <strong id="activeDeckBest">Not enough data</strong>
        <span id="activeDeckWorst">Not enough data</span>
      </div>
    </section>
    <footer id="footerSection" class="footer">
      <span>RiftLite captured automatically</span>
      <span id="updatedAt"></span>
    </footer>
  </section>
  <script>
    function setText(id, value) {
      var element = document.getElementById(id);
      if (element) element.textContent = value;
    }

    function setHidden(id, hidden) {
      var element = document.getElementById(id);
      if (element) element.hidden = Boolean(hidden);
    }

    function options(data) {
      var display = Object.assign({
        profile: 'grind',
        showBranding: true,
        showWebsite: true,
        showSession: true,
        showLatestMatch: true,
        showResult: true,
        showOpponentName: true,
        showScore: true,
        showPlatform: true,
        showDeck: true,
        showLegendWinRate: true,
        showMatchupWinRate: true,
        showActiveDeckStats: false,
        showDeckSessionStats: true,
        showDeckMatchups: true,
        showFooter: true
      }, data && data.display ? data.display : {});
      display.showBranding = true;
      return display;
    }

    function applyOptions(display) {
      document.body.className = '${layout} profile-' + String(display.profile || 'grind');
      setHidden('brandSection', false);
      setHidden('websiteText', !display.showWebsite);
      setHidden('sessionSection', !display.showSession);
      setHidden('matchSection', !display.showLatestMatch);
      setHidden('resultPill', !display.showResult);
      setHidden('deckName', !display.showDeck);
      setHidden('legendStat', !display.showLegendWinRate);
      setHidden('matchupStat', !display.showMatchupWinRate);
      setHidden('statsSection', !display.showLegendWinRate && !display.showMatchupWinRate);
      setHidden('deckStatsSection', !display.showActiveDeckStats);
      setHidden('activeDeckSessionChip', !display.showDeckSessionStats);
      setHidden('activeDeckMatchupChip', !display.showDeckMatchups);
      setHidden('footerSection', !display.showFooter);
      syncLandscapeGrid(display);
    }

    function syncLandscapeGrid(display) {
      if ('${layout}' !== 'landscape') return;
      var overlay = document.querySelector('.overlay');
      if (!overlay) return;
      var columns = ['145px'];
      if (display.showSession) columns.push('118px');
      if (display.showLatestMatch) columns.push('minmax(0, 1fr)');
      if (display.showLegendWinRate || display.showMatchupWinRate) columns.push('220px');
      overlay.style.gridTemplateColumns = columns.join(' ');
      if (display.profile === 'compact') {
        overlay.style.width = '560px';
      } else if (display.profile === 'deck-focused' || display.showActiveDeckStats) {
        overlay.style.width = '860px';
      } else if (columns.length <= 3) {
        overlay.style.width = '640px';
      } else {
        overlay.style.width = '760px';
      }
    }

    function statValue(stat) {
      if (!stat || !stat.total) return "Pending";
      return String(stat.winRate || 0) + "%";
    }

    function statRecord(stat) {
      if (!stat || !stat.total) return "0 matches";
      return String(stat.record || "0-0") + " | " + String(stat.total) + " match" + (stat.total === 1 ? "" : "es");
    }

    function liveLabel(live) {
      if (!live) return "";
      var matchup = live.myChampion && live.opponentChampion
        ? String(live.myChampion) + " vs " + String(live.opponentChampion)
        : live.opponentChampion
          ? "vs " + String(live.opponentChampion)
          : live.opponentName
            ? "vs " + String(live.opponentName)
            : "Current game";
      var parts = [matchup];
      if (live.score) parts.push(String(live.score));
      if (live.gameNumber && Number(live.gameNumber) > 1) parts.push("G" + String(live.gameNumber));
      return "Live: " + parts.join(" | ");
    }

    async function update() {
      try {
        const res = await fetch('/overlay/data.json', { cache: 'no-store' });
        const data = await res.json();
        const display = options(data);
        applyOptions(display);
        const session = data.session || {};
        const live = data.live || null;
        const liveText = liveLabel(live);
        setText('livePill', liveText || 'Live match');
        setHidden('livePill', !liveText);
        setText('sessionRecord', session.record || '0-0');
        setText('sessionMeta', String(session.total || 0) + (session.reset ? ' matches since reset' : ' matches today'));
        const latest = data.latest;
        setText('resultPill', latest ? latest.result : 'Waiting');
        setText('matchup', latest ? (latest.myChampion || 'Unknown') + ' vs ' + (latest.opponentChampion || 'Unknown') : 'Waiting for captured match');
        var meta = [];
        if (latest && display.showOpponentName && latest.opponentName) meta.push('Opponent ' + latest.opponentName);
        if (latest && display.showScore && latest.score) meta.push('Score ' + latest.score);
        if (latest && display.showPlatform && latest.platform) meta.push(String(latest.platform).toUpperCase());
        setText('matchMeta', latest ? (meta.join(' | ') || 'Match captured') : 'Capture starts automatically');
        setHidden('matchMeta', latest && !meta.length);
        setText('deckName', latest && latest.deckName ? latest.deckName : 'Deck pending');
        setText('legendWr', statValue(data.legendStats));
        setText('legendRecord', statRecord(data.legendStats));
        setText('matchupWr', statValue(data.matchupStats));
        setText('matchupRecord', statRecord(data.matchupStats));
        const deck = data.activeDeckStats;
        setText('activeDeckTitle', deck ? deck.title : 'No active deck');
        setText('activeDeckMeta', deck ? deck.legend : 'Set one from Decks');
        setText('activeDeckRecord', deck ? deck.record : '0-0');
        setText('activeDeckWr', deck ? deck.winRate : 'No matches');
        setText('activeDeckSession', deck ? deck.sessionRecord : '0-0');
        setText('activeDeckBest', deck ? 'Best ' + deck.bestMatchup : 'Not enough data');
        setText('activeDeckWorst', deck ? 'Worst ' + deck.worstMatchup : 'Not enough data');
        setText('updatedAt', data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
      } catch {}
    }
    update();
    setInterval(update, 2000);
  </script>
</body>
</html>`;
}
