export type GamePlatform = "tcga" | "atlas" | "sim";

export type MatchSource = "capture" | "scorepad" | "manual";

export type CaptureKind =
  | "capture-ready"
  | "network-fetch"
  | "network-xhr"
  | "network-websocket"
  | "dom-mutation"
  | "match-snapshot"
  | "match-start"
  | "match-update"
  | "match-end"
  | "debug";

export type CaptureHealthState =
  | "idle"
  | "loading"
  | "watching"
  | "match-detected"
  | "review-needed"
  | "saved"
  | "weaker-mode"
  | "error";

export interface CaptureEvent {
  id: string;
  platform: GamePlatform;
  kind: CaptureKind;
  capturedAt: string;
  url: string;
  payload: Record<string, unknown>;
}

export interface BattlefieldCandidate {
  side: "me" | "opponent" | "unknown";
  image: string;
  code: string;
  text: string;
  classes: string;
  hidden: boolean;
  capturedAt: string;
  listIndex?: number;
  index?: number;
  reversedIndex?: number;
  rect?: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

export interface CaptureHealth {
  platform: GamePlatform | "none";
  state: CaptureHealthState;
  message: string;
  lastEventAt?: string;
  eventCount: number;
}

export interface MatchGame {
  gameNumber: number;
  result: "Win" | "Loss" | "Draw" | "Incomplete";
  myPoints?: number;
  oppPoints?: number;
  myBattlefield?: string;
  oppBattlefield?: string;
  myBattlefieldImage?: string;
  oppBattlefieldImage?: string;
  extraBattlefields?: string[];
  wentFirst?: "1st" | "2nd" | "undecided" | "";
}

export interface MatchDraft {
  id: string;
  platform: GamePlatform;
  source?: MatchSource;
  deletedAt?: string;
  manualRepair?: boolean;
  combinedFromMatchIds?: string[];
  combinedAt?: string;
  combinedBy?: "user";
  mergedIntoMatchId?: string;
  hiddenFromStats?: boolean;
  hiddenFromHistory?: boolean;
  keepReplay?: boolean;
  testingSessionId?: string;
  testingSessionLabel?: string;
  status: "pending-review" | "saved" | "incomplete";
  capturedAt: string;
  updatedAt: string;
  result: "Win" | "Loss" | "Draw" | "Incomplete";
  format: "Bo1" | "Bo3" | "Auto";
  score: string;
  myName: string;
  opponentName: string;
  myChampion: string;
  opponentChampion: string;
  myBattlefield: string;
  opponentBattlefield: string;
  deckName: string;
  deckSourceId: string;
  deckSourceUrl?: string;
  deckSourceKey?: string;
  deckSnapshotJson?: string;
  flags: string;
  notes: string;
  games: MatchGame[];
  rawEvidence: CaptureEvent[];
  sync: {
    community: "disabled" | "pending" | "synced" | "failed";
    hubs: Record<string, "pending" | "synced" | "failed">;
    teams: Record<string, "pending" | "synced" | "failed">;
  };
}

export interface TestingSession {
  id: string;
  label: string;
  goal: string;
  deckId?: string;
  deckName?: string;
  startedAt: string;
  endedAt?: string;
  notes?: string;
}

export interface DeckEntry {
  qty: number;
  name: string;
  cardId?: string;
  imageUrl?: string;
  costEnergy?: number;
  costPower?: number;
}

export interface DeckSnapshot {
  title: string;
  legend: string;
  legendKey: string;
  legendEntry?: DeckEntry;
  sourceUrl: string;
  sourceKey: string;
  runes: DeckEntry[];
  battlefields: DeckEntry[];
  mainDeck: DeckEntry[];
  sideboard: DeckEntry[];
  tcgaMeta?: Record<string, unknown>;
}

export interface SavedDeck {
  id: string;
  sourceUrl: string;
  sourceKey: string;
  title: string;
  legend: string;
  snapshotJson: string;
  lastImportedAt: string;
  lastRefreshStatus: string;
  lastRefreshError: string;
}

export type DeckTestingGoalStatus = "Active" | "Done" | "Paused";
export type DeckCardWatchStatus = "Testing" | "Overperforming" | "Underperforming" | "Cut candidate";
export type DeckGuideSource = "default" | "matchup" | "none";

export interface DeckTestingGoal {
  id: string;
  text: string;
  status: DeckTestingGoalStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface DeckVersionEntry {
  id: string;
  snapshotHash: string;
  title: string;
  legend: string;
  sourceKey: string;
  sourceUrl: string;
  importedAt: string;
  summary: string;
}

export interface DeckCardWatchItem {
  id: string;
  cardKey: string;
  cardName: string;
  cardId?: string;
  imageUrl?: string;
  status: DeckCardWatchStatus;
  note: string;
  createdAt: string;
  updatedAt?: string;
}

export interface DeckGuideCardRef {
  id: string;
  cardKey: string;
  cardName: string;
  cardId?: string;
  imageUrl?: string;
  qty: number;
  note?: string;
  groupName?: string;
  groupTarget?: string;
  groupNote?: string;
  priority?: number;
}

export interface DeckGuideSection {
  cards: DeckGuideCardRef[];
  note: string;
}

export interface DeckGuideNote {
  id: string;
  text: string;
  createdAt: string;
  updatedAt?: string;
  source?: "deck" | "play";
}

export interface DeckMatchupGuide {
  id: string;
  legend: string;
  legendKey: string;
  updatedAt: string;
  mulligan: {
    keep: DeckGuideSection;
    consider: DeckGuideSection;
    avoid: DeckGuideSection;
  };
  sideboard: {
    in: DeckGuideSection;
    out: DeckGuideSection;
    note: string;
  };
  battlefields: {
    game1: DeckGuideSection;
    game1First: DeckGuideSection;
    game1Second: DeckGuideSection;
    note: string;
  };
  notes: DeckGuideNote[];
}

export interface DeckNotebook {
  deckId: string;
  updatedAt: string;
  goals: DeckTestingGoal[];
  versions: DeckVersionEntry[];
  watchlist: DeckCardWatchItem[];
  defaultGuide: DeckMatchupGuide;
  matchupGuides: DeckMatchupGuide[];
}

export interface DeckNotebookExport {
  format: "riftlite.deck-notebook";
  version: 1;
  exportedAt: string;
  deck: SavedDeck;
  notebook: DeckNotebook;
}

export interface DeckPackageExport {
  format: "riftlite.deck-package";
  version: 1;
  exportedAt: string;
  deck: SavedDeck;
  notebook: DeckNotebook;
}

export interface DeckPackageImportResult {
  deck: SavedDeck;
  notebook: DeckNotebook;
}

export interface ActiveDeckPrep {
  deck: SavedDeck | null;
  notebook: DeckNotebook | null;
  guide: DeckMatchupGuide | null;
  opponentLegend: string;
  source: DeckGuideSource;
}

export type DeckTrackerZone = "hand" | "board" | "base" | "stack" | "trash" | "discard" | "unknown";
export type DeckTrackerConfidence = "tracked" | "estimated";
export type DeckTrackerObservationSource = "dom" | "vision" | "manual" | "event";
export type VisionDeckTrackerState = "disabled" | "waiting-for-deck" | "calibrating" | "active" | "low-confidence" | "paused" | "error";
export type DeckTrackerPerformanceMode = "light" | "balanced" | "responsive";

export interface DeckTrackerObservation {
  cardKey: string;
  name: string;
  code: string;
  cardId: string;
  imageUrl: string;
  zone: DeckTrackerZone;
  count: number;
  platform: GamePlatform;
  confidence: DeckTrackerConfidence;
  capturedAt: string;
  source?: DeckTrackerObservationSource;
  confidenceScore?: number;
  frameId?: string;
  instanceId?: string;
  ownerPlayerId?: string;
  zoneRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface VisionDeckTrackerSuggestion {
  cardKey: string;
  name: string;
  code: string;
  cardId: string;
  imageUrl: string;
  zone: DeckTrackerZone;
  platform: GamePlatform;
  confidenceScore: number;
  capturedAt: string;
  frameId: string;
  zoneRect?: DeckTrackerObservation["zoneRect"];
}

export interface VisionDeckTrackerStatus {
  state: VisionDeckTrackerState;
  enabled: boolean;
  active: boolean;
  platform: GamePlatform | "none";
  message: string;
  updatedAt: string;
  frameId: string;
  confidenceScore: number;
  processedFrames: number;
  skippedFrames: number;
  suggestions: VisionDeckTrackerSuggestion[];
}

export interface VisionRenderedCardObservation {
  name: string;
  code: string;
  cardId: string;
  imageUrl: string;
  zone: DeckTrackerZone;
  platform: GamePlatform;
  confidenceScore: number;
  zoneRect?: DeckTrackerObservation["zoneRect"];
}

export interface VisionFrameCandidate {
  zone: DeckTrackerZone;
  platform: GamePlatform;
  confidenceScore: number;
  zoneRect: NonNullable<DeckTrackerObservation["zoneRect"]>;
  reason?: string;
}

export interface VisionFrameSample {
  dataUrl: string;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  capturedAt: string;
}

export interface DeckTrackerCorrection {
  cardKey: string;
  delta: number;
  capturedAt: string;
}

export type DeckTrackerCardRole = "main" | "sideboard" | "legend";
export type DeckTrackerSideboardDirection = "in" | "out";
export type DeckTrackerSideboardSource = "atlas" | "manual";

export interface DeckTrackerSideboardChange {
  id: string;
  cardKey: string;
  name: string;
  code: string;
  cardId: string;
  imageUrl: string;
  qty: number;
  direction: DeckTrackerSideboardDirection;
  source: DeckTrackerSideboardSource;
  gameNumber?: number;
  capturedAt: string;
}

export interface DeckTrackerSideboardCardOption {
  cardKey: string;
  name: string;
  code: string;
  cardId: string;
  imageUrl: string;
  qty: number;
  role: DeckTrackerCardRole;
}

export interface DeckTrackerSideboardState {
  gameNumber?: number;
  phase: string;
  autoDetected: boolean;
  hasManualChanges: boolean;
  changes: DeckTrackerSideboardChange[];
  mainOptions: DeckTrackerSideboardCardOption[];
  sideboardOptions: DeckTrackerSideboardCardOption[];
}

export interface DeckTrackerCardState {
  cardKey: string;
  name: string;
  code: string;
  cardId: string;
  imageUrl: string;
  role: DeckTrackerCardRole;
  deckCount: number;
  seenCount: number;
  manualDelta: number;
  copiesLeft: number;
  pinned: boolean;
  confidence: DeckTrackerConfidence;
  odds: {
    next1: number;
    next2: number;
    next3: number;
  };
}

export interface DeckTrackerOpponentCardState {
  cardKey: string;
  name: string;
  code: string;
  cardId: string;
  imageUrl: string;
  count: number;
  zones: DeckTrackerZone[];
  firstSeenAt: string;
  lastSeenAt: string;
  confidence: DeckTrackerConfidence;
}

export interface DeckTrackerOpponentState {
  totalSeen: number;
  totalKnown: number;
  updatedAt: string;
  knownCards: DeckTrackerOpponentCardState[];
  cards: DeckTrackerOpponentCardState[];
}

export interface DeckTrackerState {
  active: boolean;
  reason: string;
  deckId: string;
  deckTitle: string;
  deckLegend: string;
  opponentLegend: string;
  platform: GamePlatform | "none";
  confidence: DeckTrackerConfidence;
  deckSize: number;
  cardsLeft: number;
  seenCount: number;
  updatedAt: string;
  pinnedCards: string[];
  corrections: DeckTrackerCorrection[];
  cards: DeckTrackerCardState[];
  sideboard: DeckTrackerSideboardState;
  opponent: DeckTrackerOpponentState;
}

export interface DeckTrackerSnapshot {
  id: string;
  capturedAt: string;
  reason: string;
  state: DeckTrackerState;
}

export interface PrivateHub {
  id: string;
  name: string;
  sync: boolean;
  passwordHash?: string;
  joinedAt?: string;
  role?: "owner" | "admin" | "member";
  claimed?: boolean;
  imageDataUrl?: string;
  imageUpdatedAt?: string;
}

export interface HubActionResult {
  hub: PrivateHub;
  settings: UserSettings;
}

export interface PrivateHubSyncResult {
  matched: number;
  synced: number;
  failed: number;
  skipped: number;
  message: string;
}

export type ReplayStructuredEventType =
  | "setup"
  | "mulligan"
  | "turn-start"
  | "turn-end"
  | "play"
  | "move"
  | "draw"
  | "score"
  | "combat"
  | "result"
  | "action"
  | "scoreboard"
  | "battlefield";

export interface ReplayStructuredEvent {
  id: string;
  sourceEventId: string;
  gameNumber: number;
  capturedAt: string;
  labelTime: string;
  type: ReplayStructuredEventType;
  side: "me" | "opponent" | "system" | "unknown";
  text: string;
  cardName: string;
  cardId?: string;
  cardCount?: number;
  destination: string;
  fromZone?: string;
  toZone?: string;
  visibility?: "public" | "private-local" | "private-opponent" | "hidden";
  actionId?: string;
  undoOf?: string;
  battlefield: string;
  pointsScored?: number;
  scoreReason?: "hold" | "conquer" | "manual" | "card-effect";
  mulligan?: {
    options?: ReplayStructuredCard[];
    kept?: ReplayStructuredCard[];
    redrawn?: ReplayStructuredCard[];
    redrawCount?: number;
  };
  resource?: {
    energy?: number;
    power?: number;
    xp?: number;
    runesReady?: number;
    runesExhausted?: number;
    runes?: string[];
    mode?: "gain" | "pay" | "set" | "ready-rune" | "exhaust-rune";
    after?: ReplayStructuredResourceState;
  };
  counter?: {
    name: string;
    delta: number;
    value?: number;
    targetCardId?: string;
  };
  token?: {
    name: string;
    type: string;
    might?: number;
  };
  combat?: {
    battlefield?: string;
    winner?: "me" | "opponent" | "draw" | "unresolved";
    attackers?: ReplayStructuredCard[];
    defenders?: ReplayStructuredCard[];
  };
  snapshot?: ReplayStructuredSnapshot;
  score?: {
    me?: number;
    opponent?: number;
  };
  battlefields?: Array<{
    side: "me" | "opponent" | "unknown";
    name: string;
    code: string;
    image: string;
  }>;
  screenshot?: {
    path: string;
    url: string;
    label: string;
    capturedAt: string;
    source: string;
  };
}

export interface ReplayStructuredCard {
  id: string;
  name: string;
  code: string;
  type: string;
  imageUrl: string;
}

export interface ReplayStructuredResourceState {
  energy: number;
  power: number;
  xp: number;
  runesReady: number;
  runesExhausted: number;
}

export interface ReplayStructuredSnapshot {
  resources: {
    me: ReplayStructuredResourceState;
    opponent: ReplayStructuredResourceState;
  };
  zones: {
    me: Record<string, number>;
    opponent: Record<string, number>;
  };
  knownOpponentCards: ReplayStructuredCard[];
}

export interface RiftboundSimEvent {
  id: string;
  matchId: string;
  gameNumber: number;
  sequence: number;
  actionId: string;
  undoOf?: string;
  type:
    | "match-start"
    | "game-start"
    | "setup"
    | "mulligan-options"
    | "mulligan-choice"
    | "mulligan-redraw"
    | "draw"
    | "play"
    | "move"
    | "reveal"
    | "recycle"
    | "ready"
    | "exhaust"
    | "token-create"
    | "counter-change"
    | "resource-pay"
    | "resource-change"
    | "combat"
    | "score"
    | "turn-start"
    | "turn-end"
    | "undo"
    | "match-end"
    | "state-snapshot";
  emittedAt: string;
  actor: "me" | "opponent" | "system";
  visibility: "public" | "private-local" | "private-opponent" | "hidden";
  text: string;
  format: "Bo1" | "Bo3" | "Auto";
  players: {
    me: {
      name: string;
      legend: string;
      deckName: string;
    };
    opponent: {
      name: string;
      legend: string;
      deckName: string;
    };
  };
  card?: ReplayStructuredCard;
  cards?: ReplayStructuredCard[];
  cardCount?: number;
  fromZone?: string;
  toZone?: string;
  destination?: string;
  battlefield?: string;
  pointsScored?: number;
  scoreReason?: "hold" | "conquer" | "manual" | "card-effect";
  score?: {
    me: number;
    opponent: number;
  };
  mulligan?: {
    options?: ReplayStructuredCard[];
    kept?: ReplayStructuredCard[];
    redrawn?: ReplayStructuredCard[];
    redrawCount?: number;
  };
  resource?: {
    energy?: number;
    power?: number;
    xp?: number;
    runesReady?: number;
    runesExhausted?: number;
    runes?: string[];
    mode?: "gain" | "pay" | "set" | "ready-rune" | "exhaust-rune";
    after?: ReplayStructuredResourceState;
  };
  counter?: {
    name: string;
    delta: number;
    value?: number;
    targetCardId?: string;
  };
  token?: {
    name: string;
    type: string;
    might?: number;
  };
  combat?: {
    battlefield?: string;
    winner?: "me" | "opponent" | "draw" | "unresolved";
    attackers?: ReplayStructuredCard[];
    defenders?: ReplayStructuredCard[];
  };
  snapshot?: ReplayStructuredSnapshot;
  active: boolean;
  result?: MatchDraft["result"];
}

export interface ReplayRecord {
  id: string;
  matchId: string;
  platform: GamePlatform;
  capturedAt: string;
  deletedAt?: string;
  schemaVersion?: 1 | 2 | 3 | 4;
  title: string;
  players: {
    me: string;
    opponent: string;
  };
  events: CaptureEvent[];
  structuredEvents?: ReplayStructuredEvent[];
  visualFrames?: ReplayScreenshotFrame[];
  video?: ReplayVideoAsset;
  trim?: ReplayTrimRange;
  layers?: ReplayTeachingLayer[];
  flags?: ReplayFlag[];
  annotations?: ReplayAnnotation[];
  voiceNotes?: ReplayVoiceNote[];
  deckTrackerSnapshots?: DeckTrackerSnapshot[];
  rawCapture?: RawCaptureReplayMetadata;
  coachingPack?: ReplayCoachingPackMetadata;
  matchSnapshot?: MatchDraft;
  search?: ReplaySearchMetadata;
  importedAt?: string;
  importedFrom?: string;
}

export interface ReplayCoachingPackMetadata {
  title: string;
  author: string;
  summary: string;
  purpose: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ReplayTeachingLayer {
  id: string;
  name: string;
  author: string;
  color: string;
  createdAt: string;
}

export interface ReplayTrimRange {
  startCapturedAt: string;
  endCapturedAt: string;
  startFrameKey: string;
  endFrameKey: string;
  savedAt: string;
}

export interface ReplayFlag {
  id: string;
  targetType: "replay" | "turn" | "frame" | "video-time";
  targetId: string;
  targetLabel: string;
  type?: ReplayFlagType;
  customType?: string;
  layerId?: string;
  label: string;
  note: string;
  capturedAt: string;
  createdAt: string;
  updatedAt?: string;
  timeMs?: number;
  thumbnailPath?: string;
}

export type ReplayFlagType =
  | "key-turn"
  | "mistake"
  | "good-line"
  | "missed-lethal"
  | "battlefield-decision"
  | "rules-check"
  | "custom";

export type ReplayAnnotationTool = "pen" | "arrow" | "highlight" | "text";

export interface ReplayAnnotationPoint {
  x: number;
  y: number;
}

export interface ReplayAnnotation {
  id: string;
  targetType: "frame" | "video-time";
  targetId: string;
  targetLabel: string;
  capturedAt: string;
  timeMs?: number;
  tool: ReplayAnnotationTool;
  layerId?: string;
  clipId?: string;
  offsetMs?: number;
  color: string;
  width: number;
  points: ReplayAnnotationPoint[];
  text?: string;
  note?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ReplayVoiceNote {
  id: string;
  flagId: string;
  layerId?: string;
  mimeType: string;
  dataUrl: string;
  durationMs: number;
  sizeBytes: number;
  createdAt: string;
  updatedAt?: string;
}

export interface ReplayScreenshotFrame {
  path: string;
  url: string;
  label: string;
  capturedAt: string;
  source: "timed-replay" | "riftreplay" | "capture" | "replay-keyframe";
  hash?: string;
}

export type ReplayVideoQuality = "compact" | "balanced" | "sharp" | "sharp30" | "youtube";
export type ReplayVideoCaptureMode = "game-frame" | "system-window";
export type ReplayVideoMimeType = "video/webm" | "video/mp4";
export type ReplayFramePreset = "light" | "standard" | "detailed";

export interface ReplayVideoAsset {
  path: string;
  url: string;
  filename: string;
  directory: string;
  mimeType: ReplayVideoMimeType;
  source: "game-frame-direct" | "system-window-crop" | "webview-canvas" | "riftreplay";
  platform: GamePlatform;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  sizeBytes: number;
  width: number;
  height: number;
  fps: number;
  captureIntervalMs: number;
  bitrateKbps: number;
  actualBitrateKbps?: number;
  codec: string;
  quality: ReplayVideoQuality;
  hasAudio?: boolean;
  containerFinalized?: boolean;
}

export interface ReplayVideoSession {
  id: string;
  path: string;
  url: string;
  filename: string;
  directory: string;
  startedAt: string;
}

export interface ReplayVideoStartOptions {
  platform: GamePlatform;
  title: string;
  quality: ReplayVideoQuality;
  mimeType: ReplayVideoMimeType;
}

export interface ReplayVideoFinalizeOptions {
  platform: GamePlatform;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  captureIntervalMs: number;
  bitrateKbps: number;
  actualBitrateKbps?: number;
  codec: string;
  quality: ReplayVideoQuality;
  mimeType: ReplayVideoMimeType;
  source: "game-frame-direct" | "system-window-crop";
  hasAudio?: boolean;
}

export interface ReplayVideoMergeOptions {
  platform: GamePlatform;
  title: string;
  quality: ReplayVideoQuality;
}

export interface ReplayVideoKeyframeOptions {
  replayId: string;
  dataUrl: string;
  label: string;
  capturedAt: string;
}

export interface ReplayMp4ExportOptions {
  includeFlags: boolean;
  includeDrawings: boolean;
  includeVoiceNotes: boolean;
  includeOriginalAudio: boolean;
  mode?: "full" | "clip";
  clipStartMs?: number;
  clipDurationMs?: number;
  watermark?: boolean;
  layout?: "landscape" | "vertical-center" | "vertical-custom";
  cropFocusX?: number;
  cropFocusY?: number;
  cropZoom?: number;
}

export interface ReplayPresentationRecordingPayload {
  data: ArrayBuffer;
  mimeType: string;
  durationMs: number;
}

export interface ReplayWindowCaptureSource {
  id: string;
  name: string;
}

export interface ReplaySearchMetadata {
  title: string;
  platform: GamePlatform;
  players: string[];
  legends: string[];
  battlefields: string[];
  format: MatchDraft["format"] | "";
  result: MatchDraft["result"] | "";
  score: string;
  capturedAt: string;
  deckName: string;
}

export interface ReplayBundleFrame {
  id: string;
  eventId: string;
  label: string;
  capturedAt: string;
  sourcePath: string;
  sourceUrl: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
}

export interface ReplayBundleVideo {
  sourcePath: string;
  sourceUrl: string;
  mimeType: ReplayVideoMimeType;
  data: string;
  asset: ReplayVideoAsset;
}

export interface RiftReplayBundle {
  format: "riftlite.replay";
  version: 1 | 2 | 3 | 4;
  exportedAt: string;
  replay: ReplayRecord;
  match?: MatchDraft;
  search: ReplaySearchMetadata;
  frames: ReplayBundleFrame[];
  video?: ReplayBundleVideo;
  coachingPack?: ReplayCoachingPackMetadata;
}

export interface CommunityMatch {
  id: string;
  uid: string;
  username: string;
  date: string;
  result: string;
  myChampion: string;
  opponentChampion: string;
  opponentName: string;
  format: "Bo1" | "Bo3" | "Auto";
  score: string;
  wentFirst: string;
  myBattlefield: string;
  opponentBattlefield: string;
  flags: string;
  gamesJson: string;
  deckName: string;
  deckSourceUrl: string;
  deckSourceKey: string;
  deckSnapshotJson: string;
  createdAt: number;
  manualRepair?: boolean;
  combinedFromMatchIds?: string[];
  mergedIntoMatchId?: string;
  superseded?: boolean;
  supersededAt?: string;
  scope: "community" | "hub" | "team";
  hubId?: string;
}

export interface MatchHistoryCsvExportPayload {
  scope: "personal" | "hub";
  label?: string;
  matches: Array<MatchDraft | CommunityMatch>;
}

export interface BattlefieldOption {
  name: string;
  aliases: string[];
}

export interface ImportSummary {
  importedMatches: number;
  importedHubs: number;
  importedSettings: number;
  sourcePath: string;
}

export interface RiftLiteBackupOptions {
  includeRecycleBin: boolean;
}

export interface RiftLiteBackupFile {
  format: "riftlite.backup";
  version: 1;
  exportedAt: string;
  appVersion: string;
  settings: UserSettings;
  matches: MatchDraft[];
  deletedMatches: MatchDraft[];
  decks: SavedDeck[];
  notebooks: DeckNotebook[];
  replays: ReplayRecord[];
  deletedReplays: ReplayRecord[];
}

export interface RiftLiteBackupSummary {
  path: string;
  exportedAt: string;
  appVersion: string;
  matches: number;
  deletedMatches: number;
  decks: number;
  notebooks: number;
  replays: number;
  deletedReplays: number;
  settingsIncluded: boolean;
  preRestoreBackupPath?: string;
}

export interface AccountCloudSyncCounts {
  matches: number;
  decks: number;
  notebooks: number;
  replays: number;
}

export interface AccountCloudSyncStatus {
  enabled: boolean;
  signedIn: boolean;
  hasRemoteBackup: boolean;
  lastSyncedAt: string;
  lastRestoredAt: string;
  remoteUpdatedAt: string;
  remoteDeviceName: string;
  remoteAppVersion: string;
  remoteBytes: number;
  remoteCounts: AccountCloudSyncCounts;
  message: string;
}

export interface AccountConnectionStatus {
  connected: boolean;
  verified: boolean;
  uid: string;
  email: string;
  displayName: string;
  handle: string;
  profileComplete: boolean;
  replayLibraryReady: boolean;
  replayCount: number;
  replayAutoUploadEnabled: boolean;
  replayAutoUploadAccountMatches: boolean;
  migrationState: "ready" | "pending" | "attention";
  migrationMessage: string;
  checkedAt: string;
  message: string;
}

export type OverlayProfile = "compact" | "tournament" | "grind" | "deck-focused" | "privacy" | "caster";

export interface OverlayDisplayOptions {
  profile: OverlayProfile;
  showBranding: boolean;
  showWebsite: boolean;
  showSession: boolean;
  showLatestMatch: boolean;
  showResult: boolean;
  showOpponentName: boolean;
  showScore: boolean;
  showPlatform: boolean;
  showDeck: boolean;
  showLegendWinRate: boolean;
  showMatchupWinRate: boolean;
  showActiveDeckStats: boolean;
  showDeckSessionStats: boolean;
  showDeckMatchups: boolean;
  showFooter: boolean;
}

export type RawCaptureVisibility = "private" | "unlisted" | "public";
export type RawCaptureUploadStatus = "disabled" | "not-uploaded" | "uploaded" | "failed" | "too-large";
export type RawCaptureProcessingStatus = "pending" | "uploading" | "processing" | "ready" | "failed";

export interface RawCaptureSettings {
  enabled: boolean;
  webReplayAutoUploadEnabled: boolean;
  webReplayAutoUploadAccountUid: string;
  webReplayDiscordShareEnabled: boolean;
  webReplayDiscordShareAccountUid: string;
  webReplayDiscordShareHubIds: string[];
  uploadEnabled: boolean;
  endpoint: string;
  apiKey: string;
  visibility: RawCaptureVisibility;
}

export interface RawCaptureFrame {
  seq: number;
  ts: number;
  dir: "in" | "out";
  socketId?: string | null;
  type?: string | null;
  raw: string;
  drop?: boolean;
  dropReason?: string | null;
}

export interface RawCaptureAppendFramePayload {
  platform: GamePlatform;
  requestUrl?: string;
  frame: RawCaptureFrame;
}

export interface RawCaptureReplayMetadata {
  provider: "riftlite-v2" | "riftreplay";
  captureSessionId: string;
  messageCount: number;
  firstSeenAt?: number;
  lastSeenAt?: number;
  roomCode?: string;
  roomCodes?: string[];
  seriesId?: string;
  matchIds?: string[];
  uploadStatus: RawCaptureUploadStatus;
  uploadUrl?: string;
  uploadId?: string;
  uploadedAt?: string;
  processingStatus?: RawCaptureProcessingStatus;
  checksumSha256?: string;
  compressedBytes?: number;
  error?: string;
  localPath?: string;
  visibility?: RawCaptureVisibility;
  webReplayAutoUploadEligible?: boolean;
  webReplayAutoUploadAccountUid?: string;
  webReplayDiscordShareEligible?: boolean;
  webReplayDiscordShareAccountUid?: string;
  webReplayDiscordShareHubIds?: string[];
  discordShareStatus?: "pending" | "shared" | "partial" | "failed";
  discordSharedHubIds?: string[];
  discordShareError?: string;
  lastUploadAttemptAt?: string;
}

export interface RawCaptureStatus {
  enabled: boolean;
  active: boolean;
  platform?: GamePlatform;
  captureSessionId?: string;
  messageCount: number;
  byteSize: number;
  capped: boolean;
  keptCount?: number;
  droppedCount?: number;
  lastFrameType?: string;
  lastError?: string;
  lastUploadUrl?: string;
}

export interface RiftLiteReplayUploadResult {
  replayId: string;
  url: string;
  visibility: RawCaptureVisibility;
  status?: RawCaptureProcessingStatus;
}

export interface RiftLiteReplayDiscordShareResult {
  replayId: string;
  url: string;
  visibility: "unlisted";
  status: "shared" | "partial" | "failed";
  sharedHubIds: string[];
  error?: string;
}

export interface ReplayEmbedSessionResult {
  url: string;
  authenticated: boolean;
  error?: string;
}

export interface UserSettings {
  username: string;
  firstRunComplete: boolean;
  lastSeenVersion: string;
  syncMode: "community-and-hubs" | "community-only" | "private-hubs-only" | "local-only" | "custom";
    communitySyncEnabled: boolean;
    firebaseUid: string;
    firebaseRefreshToken: string;
    accountUid: string;
    accountEmail: string;
  accountHandle: string;
  accountDisplayName: string;
  accountProfilePublic: boolean;
  accountLastVerifiedAt: string;
  accountLastVerificationError: string;
  accountCloudSyncEnabled: boolean;
  accountCloudSyncLastSyncedAt: string;
  accountCloudSyncLastRestoredAt: string;
  accountCloudSyncDeviceId: string;
  accountCloudSyncDeviceName: string;
  accountCloudSyncLastError: string;
  anonymousDiagnosticsEnabled: boolean;
  anonymousInstallId: string;
  anonymousInstallCreatedAt: string;
  anonymousUsageLastHeartbeatAt: string;
  anonymousUsageLastHeartbeatVersion: string;
    debugMode: boolean;
  confirmationEnabled: boolean;
  replayCaptureEnabled: boolean;
  replayKeyframesEnabled: boolean;
  replayFramePreset: ReplayFramePreset;
  replayVideoEnabled: boolean;
  replayVideoMode: ReplayVideoCaptureMode;
  replayVideoQuality: ReplayVideoQuality;
  replayMicAudioEnabled: boolean;
  replayCustomFlagTypes: string[];
  replayShadowClipEnabled: boolean;
  replayShadowClipSeconds: number;
  replayShadowClipHotkey: string;
  replayShadowClipHotkeyEnabled: boolean;
  replayQuickFlagHotkey: string;
  replayQuickFlagHotkeyEnabled: boolean;
  rawCapture: RawCaptureSettings;
  deckTrackerEnabled: boolean;
  deckTrackerAutoStart: boolean;
  deckTrackerSaveToReplay: boolean;
  deckTrackerPerformanceMode: DeckTrackerPerformanceMode;
  deckTrackerPinnedCards: Record<string, string[]>;
  microphoneDeviceId: string;
  gameZoomFactor: number;
  autoSaveAfterSeconds: number;
  overlaySessionStartedAt: string;
  overlayDisplay: OverlayDisplayOptions;
  screenshotDirectory: string;
  replayDirectory: string;
  screenshotHotkey: string;
  screenshotHotkeyEnabled: boolean;
  scorepadDeviceId: string;
  scorepadDeviceSecret: string;
  scorepadLinkedAt: string;
  activeDeckId: string;
  activeHubs: PrivateHub[];
  activeTeams: TeamSyncTarget[];
}

export interface TeamSyncTarget {
  id: string;
  slug: string;
  name: string;
  sync: boolean;
  role: SocialTeamRole | "";
  visibility: "public" | "private";
  joinedAt: string;
}

export interface BrowserInfo {
  name: "Chrome" | "Edge" | "Opera" | "Firefox";
  installed: boolean;
  path?: string;
}

export interface OverlayInfo {
  url: string;
  landscapeUrl: string;
  portraitUrl: string;
  port: number;
  simEventReceiverUrl?: string;
  simEventReceiverPort?: number;
  textDirectory: string;
  textFiles: Record<string, string>;
}

export interface CapturePlatformEvidence {
  platform: GamePlatform;
  lastEventAt: string;
  url: string;
  active: boolean;
  player: string;
  opponent: string;
  score: string;
  format: string;
  hasCards: boolean;
  cardCount: number;
  logRows: number;
  roomCode: string;
  endText: string;
  payloadKeys: string[];
}

export interface CaptureDiagnosticsSummary {
  path: string;
  totalEvents: number;
  lastEventAt: string;
  byKind: Record<string, number>;
  byPlatform: Record<GamePlatform, number>;
  latest: CapturePlatformEvidence[];
}

export interface SpotlightClickPayload {
  spotlightId: string;
  linkId: string;
  appVersion: string;
  source: string;
}

export interface AccountProfile {
  uid: string;
  email: string;
  handle: string;
  handleLower: string;
  displayName: string;
  searchable: boolean;
  publicProfile: boolean;
  showStats: boolean;
  showMatches: boolean;
  showDecks: boolean;
  showHubBadges: boolean;
  marketingConsent: boolean;
  marketingConsentAt: number;
  marketingConsentUpdatedAt: number;
  marketingConsentVersion: string;
  marketingConsentSource: string;
  createdAt: number;
  updatedAt: number;
}

export interface AccountProfileBackfillResult {
  ok: boolean;
  skipped: boolean;
  message: string;
  totalMatches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

export interface AccountLinkSession {
  sessionId: string;
  code: string;
  loginUrl: string;
  expiresAt: number;
}

export interface AccountLinkStatus {
  status: "pending" | "complete" | "expired" | "error";
  uid?: string;
  email?: string;
  displayName?: string;
  message?: string;
}

export interface AppNavigationRequest {
  view: "account" | "hubs";
  hubId?: string;
}

export interface PublicProfileSearchResult {
  uid: string;
  handle: string;
  displayName: string;
}

export interface HubMember {
  id: string;
  uid: string;
  handle: string;
  displayName: string;
  role: "owner" | "admin" | "member";
  joinedAt: number;
  updatedAt: number;
}

export interface HubInvite {
  inviteId: string;
  hubId: string;
  hubName?: string;
  targetHandle: string;
  targetUid?: string;
  senderHandle?: string;
  senderDisplayName?: string;
  delivered?: boolean;
  inviteUrl: string;
  expiresAt: number;
}

export interface HubInboxItem {
  id: string;
  type: "hub-invite";
  inviteId: string;
  hubId: string;
  hubName: string;
  senderUid: string;
  senderHandle: string;
  senderDisplayName: string;
  targetHandle: string;
  status: "open" | "accepted" | "declined" | "expired";
  createdAt: number;
  expiresAt: number;
  readAt: number;
}

export interface HubMessage {
  id: string;
  uid: string;
  handle: string;
  displayName: string;
  text: string;
  mentions: string[];
  pinned: boolean;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LfgListing {
  id: string;
  uid: string;
  handle: string;
  displayName: string;
  platform: "tcga" | "atlas";
  roomCode: string;
  format: "Bo1" | "Bo3";
  myLegend: string;
  lookingForLegends: string[];
  allowAny: boolean;
  note: string;
  status: "active" | "matched" | "closed" | "expired";
  acceptedByUid: string;
  acceptedByHandle: string;
  acceptedByDisplayName: string;
  acceptedAt: number;
  createdAt: number;
  expiresAt: number;
  closedAt: number;
  discordVoiceChannelId: string;
  discordGuildId: string;
  discordChannelUrl: string;
  discordAppUrl: string;
  discordInviteUrl: string;
  discordVoiceExpiresAt: number;
  discordVoiceCreatedAt: number;
}

export interface LfgListingDraft {
  platform: "tcga" | "atlas";
  roomCode: string;
  format: "Bo1" | "Bo3";
  myLegend: string;
  lookingForLegends: string[];
  allowAny: boolean;
  note: string;
}

export interface DiscordVoiceJoinResult {
  ok: boolean;
  attempted: boolean;
  message: string;
  usedFallback: boolean;
}

export interface SocialTeamLinks {
  x: string;
  youtube: string;
  twitch: string;
  instagram: string;
  metafy: string;
}

export interface SocialTeamProfile {
  id: string;
  slug: string;
  name: string;
  description: string;
  region: string;
  locationMode: string;
  visibility: "public" | "private";
  purposes: string[];
  recruitmentStatus: string;
  logoUrl: string;
  bannerUrl: string;
  website: string;
  discord: string;
  socials: SocialTeamLinks;
  ownerUid: string;
  ownerHandle: string;
  ownerDisplayName: string;
  memberCount: number;
  applicationCount: number;
  createdAt: number;
  updatedAt: number;
}

export type TeamModerationAction = "hide" | "restore" | "clear-logo" | "clear-banner" | "clear-images";

export interface TeamModerationRecord extends SocialTeamProfile {
  hidden: boolean;
  moderationStatus: string;
  moderationReason: string;
  moderatedAt: number;
  moderatedBy: string;
}

export type SocialTeamRole = "owner" | "admin" | "member";

export interface SocialTeamMember {
  id: string;
  uid: string;
  handle: string;
  displayName: string;
  role: SocialTeamRole;
  joinedAt: number;
  updatedAt: number;
}

export interface SocialTeamApplication {
  id: string;
  teamId: string;
  uid: string;
  handle: string;
  displayName: string;
  message: string;
  region: string;
  preferredLegends: string[];
  availability: string;
  status: "pending" | "accepted" | "declined" | "withdrawn";
  createdAt: number;
  updatedAt: number;
  reviewedAt: number;
  reviewedBy: string;
}

export interface SocialTeamMessage {
  id: string;
  uid: string;
  handle: string;
  displayName: string;
  text: string;
  mentions: string[];
  pinned: boolean;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SocialTeamDetail {
  team: SocialTeamProfile;
  members: SocialTeamMember[];
  myRole: SocialTeamRole | "";
}

export type SocialTeamDraft = Partial<Pick<
  SocialTeamProfile,
  "slug" | "name" | "description" | "region" | "locationMode" | "visibility" | "purposes" | "recruitmentStatus" | "logoUrl" | "bannerUrl" | "website" | "discord" | "socials"
>>;

export interface SocialTeamApplicationDraft {
  message: string;
  region: string;
  preferredLegends: string[];
  availability: string;
}

export interface UpdateStatus {
  state: "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  currentVersion: string;
  latestVersion?: string;
  message: string;
  progress?: number;
  manualInstallOnly?: boolean;
  downloadUrl?: string;
}

export interface ScreenshotResult {
  ok: boolean;
  path: string;
  url?: string;
  directory: string;
  filename: string;
  message: string;
  source: "manual" | "hotkey" | "replay-keyframe";
}

export interface RiftLiteApi {
  getSettings(): Promise<UserSettings>;
  saveSettings(settings: Partial<UserSettings>): Promise<UserSettings>;
  getCaptureHealth(): Promise<CaptureHealth>;
  forceCaptureReview(platform: GamePlatform): Promise<MatchDraft | null>;
  getMatches(): Promise<MatchDraft[]>;
  getDeletedMatches(): Promise<MatchDraft[]>;
  saveMatchDraft(draft: MatchDraft): Promise<MatchDraft>;
  confirmMatch(draft: MatchDraft): Promise<MatchDraft>;
  previewCombinedMatches(matchIds: string[]): Promise<import("./matchCombine.js").MatchCombinePreview>;
  saveCombinedMatches(payload: import("./matchCombine.js").MatchCombineSavePayload): Promise<MatchDraft>;
  undoCombinedMatch(combinedMatchId: string): Promise<MatchDraft[]>;
  deleteMatch(id: string): Promise<void>;
  restoreMatch(id: string): Promise<MatchDraft | null>;
  purgeMatch(id: string): Promise<void>;
  exportMatchHistoryCsv(payload: MatchHistoryCsvExportPayload): Promise<string>;
  getDecks(): Promise<SavedDeck[]>;
  importDeck(url: string): Promise<SavedDeck>;
  importDeckText(text: string): Promise<SavedDeck>;
  refreshDeck(id: string): Promise<SavedDeck>;
  renameDeck(id: string, title: string): Promise<SavedDeck>;
  deleteDeck(id: string): Promise<void>;
  setActiveDeck(id: string): Promise<UserSettings>;
  getDeckNotebook(deckId: string): Promise<DeckNotebook>;
  saveDeckNotebook(deckId: string, notebook: DeckNotebook): Promise<DeckNotebook>;
  exportDeckNotebook(deckId: string): Promise<string>;
  importDeckNotebook(): Promise<DeckNotebook | null>;
  exportDeckPackage(deckId: string, notebook?: DeckNotebook): Promise<string>;
  importDeckPackage(): Promise<DeckPackageImportResult | null>;
  exportDeckPackageText(deckId: string, notebook?: DeckNotebook): Promise<string>;
  importDeckPackageText(text: string): Promise<DeckPackageImportResult>;
  exportDeckPrepPdf(deckId: string, notebook?: DeckNotebook): Promise<string>;
  writeClipboardText(text: string): Promise<boolean>;
  getActiveDeckPrep(opponentLegend?: string): Promise<ActiveDeckPrep>;
  getDeckTrackerState(): Promise<DeckTrackerState>;
  setDeckTrackerPinnedCards(deckId: string, cardKeys: string[]): Promise<DeckTrackerState>;
  adjustDeckTrackerCard(cardKey: string, delta: number): Promise<DeckTrackerState>;
  adjustDeckTrackerSideboard(cardKey: string, direction: DeckTrackerSideboardDirection, delta: number): Promise<DeckTrackerState>;
  resetDeckTrackerSideboard(): Promise<DeckTrackerState>;
  resetDeckTrackerMatch(): Promise<DeckTrackerState>;
  openDeckTrackerWindow(): Promise<void>;
  getVisionDeckTrackerStatus(): Promise<VisionDeckTrackerStatus>;
  setVisionDeckTrackerEnabled(enabled: boolean): Promise<UserSettings>;
  calibrateVisionDeckTracker(platform: GamePlatform): Promise<VisionDeckTrackerStatus>;
  confirmVisionDeckTrackerSuggestion(cardKey: string): Promise<VisionDeckTrackerStatus>;
  rejectVisionDeckTrackerSuggestion(cardKey: string): Promise<VisionDeckTrackerStatus>;
  reportVisionDeckTrackerObservations(
    platform: GamePlatform,
    observations: DeckTrackerObservation[],
    status?: Partial<VisionDeckTrackerStatus>
  ): Promise<DeckTrackerState>;
  recordVisionDeckTrackerDebug(platform: GamePlatform, payload: Record<string, unknown>): Promise<void>;
  getReplays(): Promise<ReplayRecord[]>;
  getDeletedReplays(): Promise<ReplayRecord[]>;
  saveReplay(replay: ReplayRecord): Promise<ReplayRecord>;
  deleteReplay(id: string): Promise<void>;
  restoreReplay(id: string): Promise<ReplayRecord | null>;
  purgeReplay(id: string): Promise<void>;
  exportReplayBundle(replayId: string): Promise<string>;
  exportReplayMp4(replayId: string, options: ReplayMp4ExportOptions): Promise<string>;
  exportReplayPresentationMp4(replayId: string, payload: ReplayPresentationRecordingPayload): Promise<string>;
  exportReplayFlagsText(replayId: string): Promise<string>;
  uploadRawCapture(replayId: string): Promise<ReplayRecord | null>;
  getRawCaptureStatus(): Promise<RawCaptureStatus>;
  getRawCapturePayload(replayId: string): Promise<unknown | null>;
  uploadRawCaptureToRiftLite(replayId: string, visibility?: RawCaptureVisibility): Promise<RiftLiteReplayUploadResult>;
  shareRawCaptureToDiscord(replayId: string): Promise<RiftLiteReplayDiscordShareResult>;
  prepareReplayEmbed(replayId: string): Promise<ReplayEmbedSessionResult>;
  prepareReplayLibraryEmbed(): Promise<ReplayEmbedSessionResult>;
  importReplayBundle(): Promise<ReplayRecord | null>;
  importReplayFolder(): Promise<ReplayRecord[]>;
  openReplayFolder(): Promise<void>;
  startReplayVideoCapture(options: ReplayVideoStartOptions): Promise<ReplayVideoSession>;
  prepareReplayVideoCaptureTarget(platform: GamePlatform, mode: ReplayVideoCaptureMode): Promise<void>;
  getReplayWindowCaptureSource(): Promise<ReplayWindowCaptureSource | null>;
  appendReplayVideoChunk(sessionId: string, chunk: ArrayBuffer): Promise<void>;
  finishReplayVideoCapture(sessionId: string, options: ReplayVideoFinalizeOptions): Promise<ReplayVideoAsset>;
  mergeReplayVideos(segments: ReplayVideoAsset[], options: ReplayVideoMergeOptions): Promise<ReplayVideoAsset>;
  attachReplayVideo(matchId: string, video: ReplayVideoAsset): Promise<ReplayRecord | null>;
  discardReplayVideo(video: ReplayVideoAsset): Promise<void>;
  deleteReplayVideoByMatch(matchId: string): Promise<void>;
  saveReplayVideoKeyframe(options: ReplayVideoKeyframeOptions): Promise<ReplayScreenshotFrame>;
  loadReplayVideo(video: ReplayVideoAsset): Promise<ArrayBuffer>;
  importLegacyData(): Promise<ImportSummary>;
  exportBackup(options?: Partial<RiftLiteBackupOptions>): Promise<RiftLiteBackupSummary | null>;
  restoreBackup(): Promise<RiftLiteBackupSummary | null>;
  getCommunityMatches(forceRefresh?: boolean): Promise<CommunityMatch[]>;
  getHubMatches(hubId: string, forceRefresh?: boolean): Promise<CommunityMatch[]>;
  getTeamMatches(teamId: string, forceRefresh?: boolean): Promise<CommunityMatch[]>;
  createHub(name: string, password: string): Promise<HubActionResult>;
  joinHub(name: string, password: string): Promise<HubActionResult>;
  refreshAccountHubs(): Promise<UserSettings>;
  syncPrivateHubs(): Promise<PrivateHubSyncResult>;
  syncMatchesToHubs(matchIds: string[], hubIds: string[]): Promise<PrivateHubSyncResult>;
  deleteHubMatch(hubId: string, matchId: string): Promise<void>;
  syncTeams(): Promise<PrivateHubSyncResult>;
  syncMatchesToTeams(matchIds: string[], teamIds: string[]): Promise<PrivateHubSyncResult>;
  deleteTeamMatch(teamId: string, matchId: string): Promise<void>;
  startAccountLink(): Promise<AccountLinkSession>;
  getAccountLinkStatus(sessionId: string): Promise<AccountLinkStatus>;
  getAccountConnectionStatus(): Promise<AccountConnectionStatus>;
  repairAccountConnection(): Promise<AccountConnectionStatus>;
  getAccountProfile(): Promise<AccountProfile | null>;
  saveAccountProfile(profile: Partial<AccountProfile>): Promise<AccountProfile>;
  refreshAccountProfileMatches(): Promise<AccountProfileBackfillResult>;
  exportAccountData(): Promise<string>;
  getAccountCloudSyncStatus(): Promise<AccountCloudSyncStatus>;
  setAccountCloudSyncEnabled(enabled: boolean): Promise<AccountCloudSyncStatus>;
  uploadAccountCloudSync(): Promise<AccountCloudSyncStatus>;
  restoreAccountCloudSync(): Promise<AccountCloudSyncStatus>;
  unlinkAccount(): Promise<UserSettings>;
  searchPublicProfiles(query: string): Promise<PublicProfileSearchResult[]>;
  claimHub(hubId: string, password?: string): Promise<void>;
  getHubInbox(): Promise<HubInboxItem[]>;
  acceptHubInvite(inviteId: string): Promise<HubActionResult | null>;
  declineHubInvite(inviteId: string): Promise<void>;
  getHubMembers(hubId: string): Promise<HubMember[]>;
  createHubInvite(hubId: string, targetHandle?: string): Promise<HubInvite>;
  getHubMessages(hubId: string): Promise<HubMessage[]>;
  postHubMessage(hubId: string, text: string): Promise<HubMessage>;
  deleteHubMessage(hubId: string, messageId: string): Promise<void>;
  getLfgListings(includeMine?: boolean): Promise<LfgListing[]>;
  createLfgListing(draft: LfgListingDraft): Promise<LfgListing>;
  acceptLfgListing(listingId: string): Promise<LfgListing>;
  closeLfgListing(listingId: string): Promise<LfgListing>;
  createLfgVoice(listingId: string): Promise<LfgListing>;
  joinDiscordVoice(listing: Pick<LfgListing, "discordVoiceChannelId" | "discordGuildId" | "discordChannelUrl" | "discordAppUrl" | "discordInviteUrl">): Promise<DiscordVoiceJoinResult>;
  getSocialTeams(options?: { mine?: boolean; query?: string }): Promise<SocialTeamProfile[]>;
  createSocialTeam(draft: SocialTeamDraft): Promise<SocialTeamProfile>;
  getSocialTeam(teamId: string): Promise<SocialTeamDetail>;
  updateSocialTeam(teamId: string, patch: SocialTeamDraft): Promise<SocialTeamProfile>;
  applyToSocialTeam(teamId: string, draft: SocialTeamApplicationDraft): Promise<SocialTeamApplication>;
  getSocialTeamApplications(teamId: string): Promise<SocialTeamApplication[]>;
  reviewSocialTeamApplication(teamId: string, applicationId: string, status: "accepted" | "declined"): Promise<SocialTeamApplication>;
  getSocialTeamMessages(teamId: string): Promise<SocialTeamMessage[]>;
  postSocialTeamMessage(teamId: string, text: string): Promise<SocialTeamMessage>;
  deleteSocialTeamMessage(teamId: string, messageId: string): Promise<void>;
  updateSocialTeamMember(teamId: string, uid: string, role: "admin" | "member"): Promise<void>;
  removeSocialTeamMember(teamId: string, uid: string): Promise<void>;
  reportSocialTeam(payload: { teamId: string; targetType: "team" | "message"; targetId: string; reason: string }): Promise<void>;
  getModerationTeams(query?: string): Promise<{ isModerator: boolean; teams: TeamModerationRecord[] }>;
  moderateTeam(teamId: string, action: TeamModerationAction, reason?: string): Promise<TeamModerationRecord>;
  onAppNavigate(callback: (request: AppNavigationRequest) => void): () => void;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  getGamePreloadUrl(platform: GamePlatform): Promise<string>;
  getAssetUrl(relativePath: string): Promise<string>;
  getBattlefields(): Promise<BattlefieldOption[]>;
  notifyMatchReady(draft: MatchDraft): Promise<void>;
  detectBrowsers(): Promise<BrowserInfo[]>;
  getOverlayInfo(): Promise<OverlayInfo>;
  openOverlayTextFolder(): Promise<void>;
  getDiagnosticsPath(): Promise<string>;
  getDiagnosticsSummary(): Promise<CaptureDiagnosticsSummary>;
  createDiagnosticsBundle(): Promise<string>;
  openDiagnosticsFolder(): Promise<void>;
  takeScreenshot(): Promise<ScreenshotResult>;
  chooseScreenshotDirectory(): Promise<UserSettings>;
  openScreenshotDirectory(): Promise<void>;
  chooseReplayDirectory(): Promise<UserSettings>;
  openReplayDirectory(): Promise<void>;
  openExternalResource(url: string): Promise<void>;
  setWindowFullscreen(enabled: boolean): Promise<boolean>;
  trackSpotlightClick(payload: SpotlightClickPayload): Promise<void>;
  onCaptureEvent(callback: (event: CaptureEvent) => void): () => void;
  onCaptureHealth(callback: (health: CaptureHealth) => void): () => void;
  onMatchDraft(callback: (draft: MatchDraft) => void): () => void;
  onScreenshotSaved(callback: (result: ScreenshotResult) => void): () => void;
  onReplayShadowClipHotkey(callback: () => void): () => void;
  onReplayQuickFlagHotkey(callback: () => void): () => void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  reportRendererEvent(event: CaptureEvent): Promise<void>;
}
