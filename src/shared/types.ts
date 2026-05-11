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
  keepReplay?: boolean;
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
  };
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
}

export interface DeckTrackerCorrection {
  cardKey: string;
  delta: number;
  capturedAt: string;
}

export interface DeckTrackerCardState {
  cardKey: string;
  name: string;
  code: string;
  cardId: string;
  imageUrl: string;
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

export interface DeckTrackerState {
  active: boolean;
  reason: string;
  deckId: string;
  deckTitle: string;
  deckLegend: string;
  platform: GamePlatform | "none";
  confidence: DeckTrackerConfidence;
  deckSize: number;
  cardsLeft: number;
  seenCount: number;
  updatedAt: string;
  pinnedCards: string[];
  corrections: DeckTrackerCorrection[];
  cards: DeckTrackerCardState[];
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
  scope: "community" | "hub";
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
  deckTrackerEnabled: boolean;
  deckTrackerAutoStart: boolean;
  deckTrackerSaveToReplay: boolean;
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

export interface UpdateStatus {
  state: "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  currentVersion: string;
  latestVersion?: string;
  message: string;
  progress?: number;
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
  deleteMatch(id: string): Promise<void>;
  restoreMatch(id: string): Promise<MatchDraft | null>;
  purgeMatch(id: string): Promise<void>;
  exportMatchHistoryCsv(payload: MatchHistoryCsvExportPayload): Promise<string>;
  getDecks(): Promise<SavedDeck[]>;
  importDeck(url: string): Promise<SavedDeck>;
  importDeckText(text: string): Promise<SavedDeck>;
  refreshDeck(id: string): Promise<SavedDeck>;
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
  resetDeckTrackerMatch(): Promise<DeckTrackerState>;
  getReplays(): Promise<ReplayRecord[]>;
  getDeletedReplays(): Promise<ReplayRecord[]>;
  saveReplay(replay: ReplayRecord): Promise<ReplayRecord>;
  deleteReplay(id: string): Promise<void>;
  restoreReplay(id: string): Promise<ReplayRecord | null>;
  purgeReplay(id: string): Promise<void>;
  exportReplayBundle(replayId: string): Promise<string>;
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
  getCommunityMatches(forceRefresh?: boolean): Promise<CommunityMatch[]>;
  getHubMatches(hubId: string, forceRefresh?: boolean): Promise<CommunityMatch[]>;
  createHub(name: string, password: string): Promise<HubActionResult>;
  joinHub(name: string, password: string): Promise<HubActionResult>;
  syncPrivateHubs(): Promise<PrivateHubSyncResult>;
  syncMatchesToHubs(matchIds: string[], hubIds: string[]): Promise<PrivateHubSyncResult>;
  deleteHubMatch(hubId: string, matchId: string): Promise<void>;
  startAccountLink(): Promise<AccountLinkSession>;
  getAccountLinkStatus(sessionId: string): Promise<AccountLinkStatus>;
  getAccountProfile(): Promise<AccountProfile | null>;
  saveAccountProfile(profile: Partial<AccountProfile>): Promise<AccountProfile>;
  refreshAccountProfileMatches(): Promise<AccountProfileBackfillResult>;
  exportAccountData(): Promise<string>;
  unlinkAccount(): Promise<UserSettings>;
  searchPublicProfiles(query: string): Promise<PublicProfileSearchResult[]>;
  claimHub(hubId: string, passwordHash?: string): Promise<void>;
  getHubInbox(): Promise<HubInboxItem[]>;
  acceptHubInvite(inviteId: string): Promise<HubActionResult | null>;
  declineHubInvite(inviteId: string): Promise<void>;
  getHubMembers(hubId: string): Promise<HubMember[]>;
  createHubInvite(hubId: string, targetHandle?: string): Promise<HubInvite>;
  getHubMessages(hubId: string): Promise<HubMessage[]>;
  postHubMessage(hubId: string, text: string): Promise<HubMessage>;
  deleteHubMessage(hubId: string, messageId: string): Promise<void>;
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
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  reportRendererEvent(event: CaptureEvent): Promise<void>;
}
