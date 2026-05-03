import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Calculator,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Compass,
  ExternalLink,
  FileText,
  Film,
  Flag,
  FolderOpen,
  Gamepad2,
  Globe2,
  History,
  Images,
  Keyboard,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  MessageCircle,
  Mic,
  MonitorUp,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Shield,
  SlidersHorizontal,
  Smartphone,
  Video,
  Volume2,
  Users,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type {
  BrowserInfo,
  BattlefieldOption,
  CommunityMatch,
  CaptureDiagnosticsSummary,
  CaptureEvent,
  CaptureHealth,
  DeckEntry,
  GamePlatform,
  HubActionResult,
  ImportSummary,
  MatchGame,
  MatchDraft,
  OverlayDisplayOptions,
  OverlayInfo,
  OverlayProfile,
  PrivateHubSyncResult,
  ReplayFlag,
  ReplayAnnotation,
  ReplayAnnotationTool,
  ReplayFlagType,
  ReplayFramePreset,
  ReplayTeachingLayer,
  ReplayVoiceNote,
  ReplayRecord,
  ReplayScreenshotFrame,
  ReplayTrimRange,
  ReplayVideoAsset,
  ReplayVideoCaptureMode,
  ReplayVideoFinalizeOptions,
  ReplayVideoMimeType,
  ReplayVideoQuality,
  ReplayVideoSession,
  SavedDeck,
  ScreenshotResult,
  UpdateStatus,
  UserSettings
} from "../shared/types";
import { buildAtlasReplay, replaySnapshotCardCount, type AtlasReplayViewModel, type ReplayTimelineEvent, type ReplayTurnView } from "../shared/atlasReplay";
import { activeDeckOverlayStats, buildDeckPerformance, type DeckBattlefieldPairStat, type DeckBattlefieldStat, type DeckPerformanceStats, type DeckRecordStats } from "../shared/deckPerformance";
import { CANONICAL_LEGEND_NAMES, canonicalLegendName, legendAliasesFor, normalizeLegendName } from "../shared/legendNames";
import { legendImageUrl } from "../shared/legendImages";
import { upsertMatchPreservingOrder } from "../shared/matchList";
import { publicCommunitySyncEnabled, syncModePatch } from "../shared/syncPolicy";
import "./styles/app.css";

type ActiveView = "play" | "scorepad" | "matches" | "stats" | "spotlight" | "community" | "hubs" | "decks" | "replays" | "stream" | "settings";

const GAME_URLS: Record<GamePlatform, string> = {
  tcga: "https://tcg-arena.fr",
  atlas: "https://play.riftatlas.com"
};

const DEFAULT_HEALTH: CaptureHealth = {
  platform: "none",
  state: "idle",
  message: "Waiting for TCGA or Atlas",
  eventCount: 0
};

const DEFAULT_UPDATE_STATUS: UpdateStatus = {
  state: "idle",
  currentVersion: "0.7.0",
  message: "Updater ready"
};

const APP_VERSION_META = "0.7.0";
const RIOT_LEGAL_NOTICE = `RiftLite was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.`;
const REVIEW_DISMISS_PREFIX = "riftlite-dismissed-review:";
const DIRECT_REPLAY_MODE_MIGRATION_KEY = "riftlite-direct-replay-mode-v1";
const VIDEO_REPLAY_DEFAULTS_MIGRATION_KEY = "riftlite-video-replay-defaults-v070";
const PENDING_REVIEW_STARTUP_WINDOW_MS = 15 * 60 * 1000;
const GAME_ZOOM_MIN = 0.8;
const GAME_ZOOM_MAX = 1.6;
const GAME_ZOOM_STEP = 0.1;
const SPECIAL_BATTLEFIELDS = ["Baron Pit", "Brush"] as const;
const SPECIAL_BATTLEFIELD_KEYS = new Map(SPECIAL_BATTLEFIELDS.map((name) => [name.toLowerCase(), name]));

function clampGameZoom(value: unknown): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : 1;
  const rounded = Math.round(parsed * 100) / 100;
  return Math.min(GAME_ZOOM_MAX, Math.max(GAME_ZOOM_MIN, rounded));
}

type ReplayRecorderFormat = {
  recorderMimeType: string;
  fileMimeType: ReplayVideoMimeType;
  codec: string;
};

function supportedReplayVideoFormats(): ReplayRecorderFormat[] {
  const candidates = [
    { recorderMimeType: "video/mp4;codecs=avc1.640028", fileMimeType: "video/mp4" as const, codec: "H.264 MP4" },
    { recorderMimeType: "video/mp4;codecs=avc1.4D4028", fileMimeType: "video/mp4" as const, codec: "H.264 MP4" },
    { recorderMimeType: "video/mp4", fileMimeType: "video/mp4" as const, codec: "MP4" },
    { recorderMimeType: "video/webm;codecs=vp8", fileMimeType: "video/webm" as const, codec: "VP8 WebM" },
    { recorderMimeType: "video/webm", fileMimeType: "video/webm" as const, codec: "WebM" },
    { recorderMimeType: "video/webm;codecs=vp9", fileMimeType: "video/webm" as const, codec: "VP9 WebM" }
  ];
  return candidates.filter((candidate) => MediaRecorder.isTypeSupported(candidate.recorderMimeType));
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 MB";
  }
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${Math.max(0.1, value / (1024 * 1024)).toFixed(1)} MB`;
}

type AnalyticsMatch = {
  id: string;
  platform: GamePlatform | "community" | "hub";
  source: MatchDraft["source"] | "community" | "hub";
  result: string;
  myName: string;
  myChampion: string;
  opponentChampion: string;
  opponentName: string;
  format: MatchDraft["format"];
  score: string;
  deckName: string;
  deckSourceUrl: string;
  deckSourceKey: string;
  deckSnapshotJson: string;
  flags: string;
  notes: string;
  capturedAt: string;
  wentFirst: string;
  myBattlefield: string;
  opponentBattlefield: string;
  games: MatchGame[];
};

type StatsDrilldownSelection = {
  title: string;
  subtitle?: string;
  matches: AnalyticsMatch[];
  primaryLegend?: string;
  secondaryLegend?: string;
  showFlags?: boolean;
};

type MetaAlert = {
  title: string;
  summary: string;
  metric: string;
  score: number;
  legend: string;
  opponentLegend?: string;
  seat?: string;
  format?: MatchDraft["format"];
};

type OverlayBooleanOption = Exclude<keyof OverlayDisplayOptions, "profile">;

type MatrixFilters = {
  legend: string;
  result: string;
  format: string;
  source: string;
  seat: string;
  battlefield: string;
  flags: string;
};

type MatchHistoryFilters = {
  result: string;
  platform: string;
  format: string;
  source: string;
  seat: string;
  legend: string;
  myLegend: string;
  opponentLegend: string;
  range: string;
  sync: string;
  search: string;
};

type CommunityTab = "legend-meta" | "match-matrix" | "recent-matches";

type LeaderboardSort = "score" | "winRate" | "games" | "wins" | "name";

type LeaderboardFilters = {
  search: string;
  legend: string;
  format: string;
  range: string;
  minGames: string;
  sort: LeaderboardSort;
};

type MatrixCell = {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  winRate: number;
  matches: AnalyticsMatch[];
};

const DEFAULT_MATCH_HISTORY_FILTERS: MatchHistoryFilters = {
  result: "",
  platform: "",
  format: "",
  source: "",
  seat: "",
  legend: "",
  myLegend: "",
  opponentLegend: "",
  range: "all",
  sync: "",
  search: ""
};

const DEFAULT_MATRIX_FILTERS: MatrixFilters = {
  legend: "",
  result: "",
  format: "",
  source: "",
  seat: "",
  battlefield: "",
  flags: ""
};

const DEFAULT_OVERLAY_DISPLAY: OverlayDisplayOptions = {
  profile: "grind",
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
};

const OVERLAY_PROFILE_PRESETS: Record<OverlayProfile, { label: string; description: string; options: OverlayDisplayOptions }> = {
  compact: {
    label: "Compact",
    description: "Small lower-third with the essentials.",
    options: {
      ...DEFAULT_OVERLAY_DISPLAY,
      profile: "compact",
      showOpponentName: false,
      showPlatform: false,
      showDeck: false,
      showLegendWinRate: false,
      showMatchupWinRate: false,
      showActiveDeckStats: false,
      showFooter: false
    }
  },
  tournament: {
    label: "Tournament",
    description: "Clean result and opponent view for serious games.",
    options: {
      ...DEFAULT_OVERLAY_DISPLAY,
      profile: "tournament",
      showPlatform: false,
      showDeck: false,
      showFooter: true,
      showActiveDeckStats: false
    }
  },
  grind: {
    label: "Grind Session",
    description: "Session record, latest match, and win-rate context.",
    options: {
      ...DEFAULT_OVERLAY_DISPLAY,
      profile: "grind"
    }
  },
  "deck-focused": {
    label: "Deck Focused",
    description: "Spotlights the active deck, record, and matchups.",
    options: {
      ...DEFAULT_OVERLAY_DISPLAY,
      profile: "deck-focused",
      showActiveDeckStats: true,
      showDeckSessionStats: true,
      showDeckMatchups: true,
      showDeck: true
    }
  },
  privacy: {
    label: "Privacy Mode",
    description: "Keeps names and deck details off stream.",
    options: {
      ...DEFAULT_OVERLAY_DISPLAY,
      profile: "privacy",
      showOpponentName: false,
      showPlatform: false,
      showDeck: false,
      showActiveDeckStats: false,
      showDeckSessionStats: false,
      showDeckMatchups: false,
      showFooter: false
    }
  },
  caster: {
    label: "Caster Mode",
    description: "Readable match card with public-facing context.",
    options: {
      ...DEFAULT_OVERLAY_DISPLAY,
      profile: "caster",
      showSession: false,
      showPlatform: false,
      showDeck: false,
      showActiveDeckStats: false,
      showFooter: true
    }
  }
};

const DEFAULT_LEADERBOARD_FILTERS: LeaderboardFilters = {
  search: "",
  legend: "",
  format: "",
  range: "all",
  minGames: "0",
  sort: "score"
};

const LEGEND_PICKER_OPTIONS = CANONICAL_LEGEND_NAMES.map((name) => ({
  name,
  aliases: legendAliasesFor(name)
}));

const REPLAY_LIST_PAGE_SIZE = 60;
const REPLAY_FRAME_PRESETS: Record<ReplayFramePreset, { label: string; interval: string; note: string }> = {
  light: { label: "Light", interval: "Every 5s", note: "Smallest frame bundles" },
  standard: { label: "Standard", interval: "Every 4s", note: "Recommended default" },
  detailed: { label: "Detailed", interval: "Every 2s", note: "More frames, opt-in" }
};
const REPLAY_FLAG_TYPES: Array<{ value: ReplayFlagType; label: string }> = [
  { value: "key-turn", label: "Key turn" },
  { value: "mistake", label: "Mistake" },
  { value: "good-line", label: "Good line" },
  { value: "missed-lethal", label: "Missed lethal" },
  { value: "battlefield-decision", label: "Battlefield decision" },
  { value: "rules-check", label: "Rules check" },
  { value: "custom", label: "Custom" }
];
const REPLAY_ANNOTATION_TOOLS: Array<{ value: ReplayAnnotationTool; label: string }> = [
  { value: "pen", label: "Pen" },
  { value: "arrow", label: "Arrow" },
  { value: "highlight", label: "Highlight" },
  { value: "text", label: "Text" }
];
const REPLAY_ANNOTATION_COLORS = ["#7df9ff", "#ffd166", "#ff5c8a", "#8cff8c", "#b88cff", "#ffffff"];
const DEFAULT_REPLAY_LAYER_ID = "original";
const REPLAY_VIDEO_PROFILES: Record<ReplayVideoQuality, {
  label: string;
  width: number;
  height: number;
  fps: number;
  captureIntervalMs: number;
  bitrateKbps: number;
}> = {
  compact: { label: "Compact 540p 12fps - about 350 kbps", width: 960, height: 540, fps: 12, captureIntervalMs: 2500, bitrateKbps: 350 },
  balanced: { label: "Balanced 720p 24fps - about 900 kbps", width: 1280, height: 720, fps: 24, captureIntervalMs: 2000, bitrateKbps: 900 },
  sharp: { label: "Sharp 1080p 24fps - about 1100 kbps", width: 1920, height: 1080, fps: 24, captureIntervalMs: 1500, bitrateKbps: 1100 },
  sharp30: { label: "Sharp+ 1080p 30fps - about 2200 kbps", width: 1920, height: 1080, fps: 30, captureIntervalMs: 1250, bitrateKbps: 2200 }
};

const SYSTEM_REPLAY_FRAME_MIN_MS = 34;
const SYSTEM_REPLAY_CROP_CACHE_MS = 1000;
const SYSTEM_REPLAY_SLOW_DRAW_MS = 24;
const SYSTEM_REPLAY_BACKOFF_STEP_MS = 250;
const SYSTEM_REPLAY_MAX_BACKOFF_MS = 2500;
const REPLAY_VIDEO_ARM_THROTTLE_MS = 7_500;

type ReplayVideoRuntime = {
  mode: ReplayVideoCaptureMode;
  source: ReplayVideoFinalizeOptions["source"];
  session: ReplayVideoSession;
  platform: GamePlatform;
  profile: typeof REPLAY_VIDEO_PROFILES[ReplayVideoQuality];
  quality: ReplayVideoQuality;
  fileMimeType: ReplayVideoMimeType;
  codec: string;
  canvas?: HTMLCanvasElement;
  context?: CanvasRenderingContext2D;
  recorder: MediaRecorder;
  stream: MediaStream;
  width: number;
  height: number;
  timer: number;
  sourceStream?: MediaStream;
  sourceVideo?: ReplaySourceVideoElement;
  videoFrameCallbackId?: number;
  cropCache?: SystemReplayCrop;
  startedAt: string;
  startedMs: number;
  pendingWrites: Promise<unknown>[];
  frameCount: number;
  lastDrawAt: number;
  nextAllowedAt: number;
  slowCaptureStreak: number;
  lastCaptureMs: number;
};

type ReplaySourceVideoElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: unknown) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

type SystemWindowReplaySource = {
  stream: MediaStream;
  video?: ReplaySourceVideoElement;
  width: number;
  height: number;
  source: "game-frame-direct" | "system-window-crop";
};

type ArmedReplayVideoSource = {
  platform: GamePlatform;
  mode: Extract<ReplayVideoCaptureMode, "game-frame" | "system-window">;
  quality: ReplayVideoQuality;
  source: SystemWindowReplaySource;
};

type SystemReplayCrop = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  cacheKey: string;
  expiresAt: number;
};

const TOOLKIT_RESOURCES = [
  {
    id: "youtube",
    label: "YouTube",
    description: "BMU Casts tutorials, updates, and Riftbound content.",
    url: "https://www.youtube.com/@bmucasts",
    icon: Video
  },
  {
    id: "discord",
    label: "Discord",
    description: "RiftLite support, setup help, and community chat.",
    url: "https://discord.gg/KP3esbeBYF",
    icon: MessageCircle
  },
  {
    id: "twitch",
    label: "Twitch",
    description: "BMU Casts live stream.",
    url: "https://www.twitch.tv/bmucasts",
    icon: Radio
  },
  {
    id: "piltover",
    label: "Piltover",
    description: "Open Piltover Archive for deck resources.",
    url: "https://piltoverarchive.com",
    icon: BookOpen
  },
  {
    id: "website",
    label: "Website",
    description: "RiftLite home and download page.",
    url: "https://www.riftlite.com",
    icon: Globe2
  },
  {
    id: "guide",
    label: "Guide",
    description: "RiftLite setup and usage guide.",
    url: "https://www.riftlite.com/guide",
    icon: BookOpen
  }
] as const;

type SpotlightLink = {
  id: string;
  label: string;
  url: string;
  description: string;
  icon: typeof Globe2;
  featured?: boolean;
};

type SpotlightAssetKey = "logo" | "banner" | "tiktok" | "youtube" | "twitch";

type CommunitySpotlight = {
  id: string;
  name: string;
  kicker: string;
  location: string;
  description: string;
  primaryCta: SpotlightLink;
  links: SpotlightLink[];
  tags?: string[];
  highlights: Array<{ title: string; text: string }>;
  assets: Record<SpotlightAssetKey, string>;
  routes?: Array<{ key: SpotlightAssetKey; title: string; subtitle: string; linkId: string }>;
};

const RIFTLAB_SPOTLIGHT: CommunitySpotlight = {
  id: "riftlab",
  name: "Riftlab",
  kicker: "Community spotlight",
  location: "United Kingdom",
  description: "Riftlab runs tournaments, makes guides, and showcases VODs for in-depth Riftbound matches. It is a home for competitive Riftbound content based in the United Kingdom.",
  primaryCta: {
    id: "discord",
    label: "Join Discord",
    url: "https://discord.gg/hNBBmCP5NB",
    description: "Talk events, matches, and competitive Riftbound.",
    icon: MessageCircle,
    featured: true
  },
  links: [
    {
      id: "twitch",
      label: "Twitch",
      url: "https://www.twitch.tv/Riftlab",
      description: "Live matches, tournament coverage, and community streams.",
      icon: Radio,
      featured: true
    },
    {
      id: "youtube",
      label: "YouTube",
      url: "https://www.youtube.com/@RiftlabTCG",
      description: "Guides, match VODs, and competitive breakdowns.",
      icon: Video,
      featured: true
    },
    {
      id: "x",
      label: "X",
      url: "https://x.com/RiftlabTCG",
      description: "Announcements, brackets, and team updates.",
      icon: X
    },
    {
      id: "instagram",
      label: "Instagram",
      url: "https://www.instagram.com/RiftlabTCG",
      description: "Clips, event posts, and community highlights.",
      icon: Camera
    },
    {
      id: "tiktok",
      label: "TikTok",
      url: "https://www.tiktok.com/@riftlabtcg",
      description: "Short-form Riftbound moments and quick hits.",
      icon: Video
    },
    {
      id: "linktree",
      label: "Linktree",
      url: "https://linktr.ee/riftlab",
      description: "All Riftlab links in one place.",
      icon: Compass
    },
    {
      id: "discord",
      label: "Discord",
      url: "https://discord.gg/hNBBmCP5NB",
      description: "Community hub for events and discussion.",
      icon: MessageCircle
    }
  ],
  tags: ["United Kingdom", "Tournaments", "Guides", "Match VODs"],
  highlights: [
    {
      title: "Tournament hub",
      text: "A clean route into UK-based competitive Riftbound events and coverage."
    },
    {
      title: "Guide library",
      text: "Built around practical learning: decks, matchups, sequencing, and game review."
    },
    {
      title: "VOD showcase",
      text: "Long-form matches and in-depth replay content for players who want to improve."
    },
    {
      title: "Community-first",
      text: "A creator team page that points players toward streams, socials, and Discord without clutter."
    }
  ],
  assets: {
    logo: "community/riftlab-logo.png",
    banner: "community/riftlab-og.jpg",
    tiktok: "community/riftlab-tiktok-thumb.jpeg",
    youtube: "community/riftlab-youtube-thumb.jpeg",
    twitch: "community/riftlab-twitch-thumb.png"
  }
};

const RUNESANDRIFT_SPOTLIGHT: CommunitySpotlight = {
  id: "runesandrift",
  name: "Runes & Rift",
  kicker: "Community spotlight",
  location: "Online community",
  description: "Runes & Rift is a Riftbound hub for decks, tournaments, guides, coaching, and community updates. Their Discord also runs a ranked ladder, giving competitive players a place to keep testing between events.",
  primaryCta: {
    id: "discord",
    label: "Join Discord",
    url: "https://discord.gg/4BK66WsVuk",
    description: "Join the Runes & Rift community, ranked ladder, and events.",
    icon: MessageCircle,
    featured: true
  },
  links: [
    {
      id: "discord",
      label: "Discord",
      url: "https://discord.gg/4BK66WsVuk",
      description: "Community hub with ranked ladder, event updates, and discussion.",
      icon: MessageCircle,
      featured: true
    },
    {
      id: "website",
      label: "Website",
      url: "https://runesandrift.com/links/",
      description: "All Runes & Rift links, guides, coaching, and contact routes.",
      icon: Globe2,
      featured: true
    },
    {
      id: "youtube",
      label: "YouTube",
      url: "https://www.youtube.com/@RunesAndRift",
      description: "Tournament VODs, Riftbound coverage, and guide content.",
      icon: Video,
      featured: true
    },
    {
      id: "twitch",
      label: "Twitch",
      url: "https://www.twitch.tv/plusrb",
      description: "Live event coverage and community streams.",
      icon: Radio,
      featured: true
    },
    {
      id: "x",
      label: "X",
      url: "https://x.com/RunesAndRift",
      description: "News, deck coverage, tournament updates, and meta discussion.",
      icon: X
    },
    {
      id: "metafy",
      label: "Metafy",
      url: "https://metafy.gg/@runes-and-rift",
      description: "Support the community and find coaching options.",
      icon: Users
    },
    {
      id: "coaching",
      label: "Coaching",
      url: "https://runesandrift.com/riftbound-coaching/",
      description: "1-on-1 Riftbound coaching for new and competitive players.",
      icon: Compass
    }
  ],
  tags: ["Ranked ladder", "Tournaments", "Guides", "Coaching"],
  highlights: [
    {
      title: "Ranked ladder",
      text: "Their Discord ladder gives players a structured place to practice and track competitive progress."
    },
    {
      title: "Tournament engine",
      text: "Weekly events, Cash Cups, Invitationals, and live coverage keep competitive Riftbound moving."
    },
    {
      title: "Guide hub",
      text: "Rules, deckbuilding, turn order, keywords, and strategy content are gathered in one player-friendly route."
    },
    {
      title: "Coaching lane",
      text: "A route for players who want focused feedback, matchup work, and tournament prep."
    }
  ],
  assets: {
    logo: "community/runesandrift-logo.png",
    banner: "community/runesandrift-og.jpg",
    tiktok: "community/runesandrift-tiktok.webp",
    youtube: "community/runesandrift-youtube.webp",
    twitch: "community/runesandrift-twitch.webp"
  }
};

const CHALLENGERTCG_SPOTLIGHT: CommunitySpotlight = {
  id: "challengertcg",
  name: "Challenger TCG",
  kicker: "Community spotlight",
  location: "Competitive Riftbound",
  description: "Challenger TCG is a competitive Riftbound community built around high-level content, coaching, deck guides, and tournament preparation. Their Metafy community is positioned as a premier home for competitive Riftbound improvement.",
  primaryCta: {
    id: "metafy",
    label: "Open Metafy",
    url: "https://metafy.gg/@challenger-tcg",
    description: "View Challenger TCG coaching, deck guides, memberships, and community access.",
    icon: Users,
    featured: true
  },
  links: [
    {
      id: "metafy",
      label: "Metafy",
      url: "https://metafy.gg/@challenger-tcg",
      description: "Competitive Riftbound hub with guides, coaching, and community access.",
      icon: Users,
      featured: true
    },
    {
      id: "guides",
      label: "Deck Guides",
      url: "https://metafy.gg/@challenger-tcg/guides",
      description: "Deep deck guides with matchup plans, card choices, and cheat sheets.",
      icon: BookOpen,
      featured: true
    },
    {
      id: "coaching",
      label: "Coaching",
      url: "https://metafy.gg/@challenger-tcg/sessions",
      description: "1-on-1 coaching focused on sequencing, mulligans, matchups, and board states.",
      icon: Compass,
      featured: true
    },
    {
      id: "discord",
      label: "Discord Access",
      url: "https://metafy.gg/@challenger-tcg/members",
      description: "Community membership route for Challenger TCG Discord access.",
      icon: MessageCircle,
      featured: true
    },
    {
      id: "x",
      label: "X",
      url: "https://x.com/Challengertcg",
      description: "Challenger TCG updates and competitive Riftbound posts.",
      icon: X
    },
    {
      id: "twitch",
      label: "Twitch",
      url: "https://www.twitch.tv/challengertcg",
      description: "Live competitive coverage and community streams.",
      icon: Radio
    },
    {
      id: "youtube",
      label: "YouTube",
      url: "https://youtube.com/@ChallengerTCG",
      description: "Video content and competitive Riftbound coverage.",
      icon: Video
    }
  ],
  tags: ["Competitive hub", "Deck guides", "Coaching", "Tournament prep"],
  highlights: [
    {
      title: "Competitive hub",
      text: "A large Metafy community focused on helping players improve and succeed on the Riftbound tournament circuit."
    },
    {
      title: "Deck guide library",
      text: "Guides cover decklists, card-by-card breakdowns, matchup plans, sideboarding, and cheat sheets."
    },
    {
      title: "Coaching",
      text: "Sessions focus on decision-making, mulligans, sequencing, matchup dissection, and complicated board states."
    },
    {
      title: "Social coverage",
      text: "Challenger TCG also points players toward Twitch, X, and YouTube for competitive content."
    }
  ],
  assets: {
    logo: "community/challengertcg-logo.webp",
    banner: "community/challengertcg-og.webp",
    tiktok: "community/challengertcg-tiktok.webp",
    youtube: "community/challengertcg-youtube.webp",
    twitch: "community/challengertcg-twitch.webp"
  }
};

const NOVEGGIES_SPOTLIGHT: CommunitySpotlight = {
  id: "noveggies",
  name: "NoVeggies",
  kicker: "Coach spotlight",
  location: "Riftbound coaching",
  description: "Diego Rodriguez, better known as NoVeggies, offers focused Riftbound coaching for players who want to improve without the process feeling overwhelming. His Metafy community includes free consults, competitive 1-on-1 sessions, tournament prep, and a popular Miracle Sivir guide.",
  primaryCta: {
    id: "metafy",
    label: "Book coaching",
    url: "https://metafy.gg/@noveggies",
    description: "Open NoVeggies's Metafy community for coaching, guides, and free consultation.",
    icon: Users,
    featured: true
  },
  links: [
    {
      id: "metafy",
      label: "Metafy",
      url: "https://metafy.gg/@noveggies",
      description: "Coaching community, memberships, reviews, and profile overview.",
      icon: Users,
      featured: true
    },
    {
      id: "sessions",
      label: "Sessions",
      url: "https://metafy.gg/@noveggies/sessions",
      description: "Free consults, 1-on-1 competitive coaching, and tournament prep.",
      icon: Compass,
      featured: true
    },
    {
      id: "guides",
      label: "Guides",
      url: "https://metafy.gg/@noveggies/guides",
      description: "Miracle Sivir guide and Riftbound learning content.",
      icon: BookOpen,
      featured: true
    },
    {
      id: "x",
      label: "X",
      url: "https://x.com/NoVeggie5",
      description: "NoVeggies updates, posts, and competitive Riftbound chatter.",
      icon: X
    }
  ],
  tags: ["Coaching", "Miracle Sivir", "Tournament prep", "Free consult"],
  highlights: [
    {
      title: "Player-first coaching",
      text: "Sessions are built around clear goals, practical decisions, matchup knowledge, deck tuning, and tournament preparation."
    },
    {
      title: "Miracle Sivir guide",
      text: "His free Sivir guide gives players a structured route into the deck, covering game plan, key cards, and matchups."
    },
    {
      title: "Strong review signal",
      text: "Public Metafy reviews highlight detailed explanations, helpful energy, and practical competitive advice."
    },
    {
      title: "Tournament results",
      text: "NoVeggies brings broad competitive TCG experience across Riftbound, Digimon, Yu-Gi-Oh, and One Piece."
    }
  ],
  assets: {
    logo: "community/noveggies-coaching.jpg",
    banner: "community/noveggies-coaching.jpg",
    tiktok: "community/noveggies-coaching.jpg",
    youtube: "community/noveggies-coaching.jpg",
    twitch: "community/noveggies-coaching.jpg"
  },
  routes: [
    {
      key: "youtube",
      title: "Miracle Sivir Guide",
      subtitle: "Learn the deck plan, key cards, and matchup approach.",
      linkId: "guides"
    },
    {
      key: "twitch",
      title: "Coaching Sessions",
      subtitle: "Book focused sessions around decisions, matchups, and deck optimization.",
      linkId: "sessions"
    },
    {
      key: "tiktok",
      title: "Free Consult",
      subtitle: "Start with a short consult and find the right path for your goals.",
      linkId: "metafy"
    }
  ]
};

const AGITOSWIFTLY_SPOTLIGHT: CommunitySpotlight = {
  id: "agitoswiftly",
  name: "AgitoSwiftly",
  kicker: "Creator spotlight",
  location: "Riftbound content",
  description: "AgitoSwiftly is a Riftbound creator with a dedicated YouTube channel and social updates on X. The channel gives players another easy route into community content, match discussion, and creator-led Riftbound coverage.",
  primaryCta: {
    id: "youtube",
    label: "Watch YouTube",
    url: "https://www.youtube.com/@AgitoswiftlyIsRiftbound",
    description: "Open AgitoSwiftly's Riftbound YouTube channel.",
    icon: Video,
    featured: true
  },
  links: [
    {
      id: "youtube",
      label: "YouTube",
      url: "https://www.youtube.com/@AgitoswiftlyIsRiftbound",
      description: "Riftbound videos, creator coverage, and community-focused content.",
      icon: Video,
      featured: true
    },
    {
      id: "x",
      label: "X",
      url: "https://x.com/AgitoSwiftly",
      description: "Posts, updates, and Riftbound conversation from AgitoSwiftly.",
      icon: X,
      featured: true
    }
  ],
  tags: ["YouTube", "Creator", "Riftbound content", "Community"],
  highlights: [
    {
      title: "Video-first content",
      text: "A direct YouTube route for players who prefer Riftbound discussion and coverage in video form."
    },
    {
      title: "Social updates",
      text: "The X profile gives players a quick way to follow creator posts and community conversation."
    },
    {
      title: "Distinct branding",
      text: "AgitoSwiftly's bold creator artwork makes the spotlight easy to recognise in the app."
    },
    {
      title: "Community discovery",
      text: "A useful spotlight for players looking for more Riftbound voices to follow between games and events."
    }
  ],
  assets: {
    logo: "community/agitoswiftly.jpg",
    banner: "community/agitoswiftly.jpg",
    tiktok: "community/agitoswiftly.jpg",
    youtube: "community/agitoswiftly.jpg",
    twitch: "community/agitoswiftly.jpg"
  },
  routes: [
    {
      key: "youtube",
      title: "YouTube Channel",
      subtitle: "Watch AgitoSwiftly's Riftbound videos and creator coverage.",
      linkId: "youtube"
    },
    {
      key: "twitch",
      title: "X Updates",
      subtitle: "Follow posts, updates, and community conversation.",
      linkId: "x"
    },
    {
      key: "tiktok",
      title: "Creator Hub",
      subtitle: "Jump straight into AgitoSwiftly's Riftbound content routes.",
      linkId: "youtube"
    }
  ]
};

const COMMUNITY_SPOTLIGHTS: CommunitySpotlight[] = [
  RIFTLAB_SPOTLIGHT,
  RUNESANDRIFT_SPOTLIGHT,
  CHALLENGERTCG_SPOTLIGHT,
  NOVEGGIES_SPOTLIGHT,
  AGITOSWIFTLY_SPOTLIGHT
];

function App() {
  const [activePlatform, setActivePlatform] = useState<GamePlatform>("tcga");
  const [preloadUrl, setPreloadUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [health, setHealth] = useState<CaptureHealth>(DEFAULT_HEALTH);
  const [matches, setMatches] = useState<MatchDraft[]>([]);
  const [replays, setReplays] = useState<ReplayRecord[]>([]);
  const [deletedMatches, setDeletedMatches] = useState<MatchDraft[]>([]);
  const [deletedReplays, setDeletedReplays] = useState<ReplayRecord[]>([]);
  const [decks, setDecks] = useState<SavedDeck[]>([]);
  const [battlefields, setBattlefields] = useState<BattlefieldOption[]>([]);
  const [communityMatches, setCommunityMatches] = useState<CommunityMatch[]>([]);
  const [hubMatches, setHubMatches] = useState<Record<string, CommunityMatch[]>>({});
  const [communityStatus, setCommunityStatus] = useState("Firebase community ready");
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [reviewDraft, setReviewDraft] = useState<MatchDraft | null>(null);
  const [browsers, setBrowsers] = useState<BrowserInfo[]>([]);
  const [overlayInfo, setOverlayInfo] = useState<OverlayInfo | null>(null);
  const [diagnosticsPath, setDiagnosticsPath] = useState("");
  const [diagnosticsSummary, setDiagnosticsSummary] = useState<CaptureDiagnosticsSummary | null>(null);
  const [diagnosticsBundlePath, setDiagnosticsBundlePath] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(DEFAULT_UPDATE_STATUS);
  const [screenshotStatus, setScreenshotStatus] = useState("");
  const [actionFeedback, setActionFeedback] = useState("");
  const [updatePromptDismissedFor, setUpdatePromptDismissedFor] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("play");
  const [focusedReplayId, setFocusedReplayId] = useState("");
  const gameRef = useRef<Electron.WebviewTag | null>(null);
  const autoConfirmingRef = useRef<string>("");
  const actionFeedbackTimerRef = useRef<number | undefined>(undefined);
  const capturePromptSignatureRef = useRef("");
  const pendingReviewFallbackTimerRef = useRef<number | undefined>(undefined);
  const diagnosticsRefreshTimerRef = useRef<number | undefined>(undefined);
  const diagnosticsRefreshInFlightRef = useRef(false);
  const communityLoadedRef = useRef(false);
  const activeViewRef = useRef<ActiveView>(activeView);
  const settingsRef = useRef<UserSettings | null>(settings);
  const replayVideoRef = useRef<ReplayVideoRuntime | null>(null);
  const armedReplayVideoRef = useRef<Partial<Record<GamePlatform, ArmedReplayVideoSource>>>({});
  const replayVideoPrimeTimerRef = useRef<number | undefined>(undefined);
  const lastReplayArmAttemptRef = useRef(0);
  const gameZoom = clampGameZoom(settings?.gameZoomFactor);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    void bootstrap();
    const offEvent = window.riftlite.onCaptureEvent((event) => {
      void maybeStartReplayVideo(event);
      scheduleDiagnosticsRefresh();
    });
    const offHealth = window.riftlite.onCaptureHealth((nextHealth) => {
      setHealth(nextHealth);
      if (nextHealth.state === "review-needed") {
        showCapturePrompt(nextHealth, "Match captured - preparing the review. Checking BO3 and replay data...");
        schedulePendingReviewFallback();
      } else if (nextHealth.state === "match-detected" && nextHealth.message.toLowerCase().includes("bo3 game captured")) {
        showCapturePrompt(nextHealth, nextHealth.message);
      }
    });
    const offDraft = window.riftlite.onMatchDraft((draft) => {
      const repairedDraft = repairDraftForReview(draft);
      clearDismissedReview(repairedDraft);
      setReviewDraft(repairedDraft);
      setMatches((current) => upsertMatchPreservingOrder(current, repairedDraft));
      void refreshDecks();
      void stopReplayVideoForDraft(repairedDraft);
    });
    const offScreenshot = window.riftlite.onScreenshotSaved((result) => {
      const message = result.ok ? result.message : `Screenshot failed: ${result.message}`;
      setScreenshotStatus(message);
      showActionFeedback(message);
    });
    const offUpdate = window.riftlite.onUpdateStatus((status) => {
      setUpdateStatus(status);
      if (status.state === "available" || status.state === "downloaded") {
        showActionFeedback(status.message);
      }
    });
    return () => {
      offEvent();
      offHealth();
      offDraft();
      offScreenshot();
      offUpdate();
      if (actionFeedbackTimerRef.current) {
        window.clearTimeout(actionFeedbackTimerRef.current);
      }
      if (pendingReviewFallbackTimerRef.current) {
        window.clearTimeout(pendingReviewFallbackTimerRef.current);
      }
      if (diagnosticsRefreshTimerRef.current) {
        window.clearTimeout(diagnosticsRefreshTimerRef.current);
      }
      if (replayVideoPrimeTimerRef.current) {
        window.clearInterval(replayVideoPrimeTimerRef.current);
      }
      stopArmedReplaySources();
      void stopReplayVideoForDraft(null);
    };
  }, []);

  useEffect(() => {
    void window.riftlite.getGamePreloadUrl(activePlatform).then(setPreloadUrl);
  }, [activePlatform]);

  useEffect(() => {
    if (!settings) {
      return;
    }
    const timer = window.setTimeout(() => applyGameZoom(clampGameZoom(settings.gameZoomFactor)), 50);
    return () => window.clearTimeout(timer);
  }, [activePlatform, preloadUrl, settings?.gameZoomFactor]);

  useEffect(() => {
    function handleRefreshShortcut(event: KeyboardEvent) {
      if (activeViewRef.current !== "play") {
        return;
      }
      const key = event.key.toLowerCase();
      const wantsReload = event.key === "F5" || (event.ctrlKey && key === "r");
      if (!wantsReload) {
        return;
      }
      event.preventDefault();
      reloadGamePage(event.ctrlKey || event.shiftKey);
    }
    window.addEventListener("keydown", handleRefreshShortcut, true);
    return () => window.removeEventListener("keydown", handleRefreshShortcut, true);
  }, []);

  useEffect(() => {
    if (!reviewDraft || !settings || reviewDraft.status === "saved") {
      return;
    }
    if (!settings.confirmationEnabled) {
      if (autoConfirmingRef.current !== reviewDraft.id) {
        autoConfirmingRef.current = reviewDraft.id;
        void confirmDraft(reviewDraft);
      }
    }
  }, [reviewDraft, settings]);

  useEffect(() => {
    if (!settings || communityLoadedRef.current) {
      return;
    }
    if (activeView === "community" || activeView === "hubs") {
      void refreshCommunityData(settings);
    }
  }, [activeView, settings]);

  useEffect(() => {
    if (activeView === "settings") {
      scheduleDiagnosticsRefresh(50, true);
    }
  }, [activeView]);

  useEffect(() => {
    if (replayVideoPrimeTimerRef.current) {
      window.clearInterval(replayVideoPrimeTimerRef.current);
      replayVideoPrimeTimerRef.current = undefined;
    }
    if (!settings?.replayVideoEnabled || activeView !== "play") {
      stopArmedReplaySources();
      return;
    }
    void primeReplayVideoTarget(activePlatform);
    replayVideoPrimeTimerRef.current = window.setInterval(() => {
      void primeReplayVideoTarget(activePlatform);
    }, 30_000);
    return () => {
      if (replayVideoPrimeTimerRef.current) {
        window.clearInterval(replayVideoPrimeTimerRef.current);
        replayVideoPrimeTimerRef.current = undefined;
      }
    };
  }, [activePlatform, activeView, settings?.replayVideoEnabled, settings?.replayVideoMode]);

  async function bootstrap() {
    const [nextSettings, nextHealth, nextMatches, nextReplays, nextDeletedMatches, nextDeletedReplays, nextDecks, nextBattlefields, nextLogo, nextBrowsers, nextOverlay, nextDiagnosticsPath, nextDiagnosticsSummary, nextUpdateStatus] = await Promise.all([
      window.riftlite.getSettings(),
      window.riftlite.getCaptureHealth(),
      window.riftlite.getMatches(),
      window.riftlite.getReplays(),
      window.riftlite.getDeletedMatches(),
      window.riftlite.getDeletedReplays(),
      window.riftlite.getDecks(),
      window.riftlite.getBattlefields(),
      window.riftlite.getAssetUrl("riftlite-logo-ui.png"),
      window.riftlite.detectBrowsers(),
      window.riftlite.getOverlayInfo(),
      window.riftlite.getDiagnosticsPath(),
      window.riftlite.getDiagnosticsSummary(),
      window.riftlite.getUpdateStatus()
    ]);
    let bootSettings = nextSettings;
    try {
      if (bootSettings.replayVideoMode === "system-window" && localStorage.getItem(DIRECT_REPLAY_MODE_MIGRATION_KEY) !== "done") {
        bootSettings = await window.riftlite.saveSettings({ replayVideoMode: "game-frame" });
        localStorage.setItem(DIRECT_REPLAY_MODE_MIGRATION_KEY, "done");
      } else if (bootSettings.replayVideoMode === "game-frame") {
        localStorage.setItem(DIRECT_REPLAY_MODE_MIGRATION_KEY, "done");
      }
      const shouldApplyVideoDefaults =
        localStorage.getItem(VIDEO_REPLAY_DEFAULTS_MIGRATION_KEY) !== "done" &&
        bootSettings.replayVideoEnabled === false &&
        (bootSettings.replayVideoQuality === "compact" || !bootSettings.replayVideoQuality) &&
        (bootSettings.replayVideoMode || "game-frame") === "game-frame";
      if (shouldApplyVideoDefaults) {
        bootSettings = await window.riftlite.saveSettings({
          replayVideoEnabled: true,
          replayVideoQuality: "sharp",
          replayVideoMode: "game-frame"
        });
      }
      localStorage.setItem(VIDEO_REPLAY_DEFAULTS_MIGRATION_KEY, "done");
    } catch {
      bootSettings = nextSettings;
    }
    setSettings(bootSettings);
    setHealth(nextHealth);
    setMatches(nextMatches);
    setReplays(nextReplays);
    setDeletedMatches(nextDeletedMatches);
    setDeletedReplays(nextDeletedReplays);
    setDecks(nextDecks);
    setBattlefields(nextBattlefields);
    setLogoUrl(nextLogo);
    setBrowsers(nextBrowsers);
    setOverlayInfo(nextOverlay);
    setDiagnosticsPath(nextDiagnosticsPath);
    setDiagnosticsSummary(nextDiagnosticsSummary);
    setUpdateStatus(nextUpdateStatus);
    if (bootSettings.confirmationEnabled) {
      const pendingReview = latestPendingReviewMatch(nextMatches, { maxAgeMs: PENDING_REVIEW_STARTUP_WINDOW_MS });
      if (pendingReview) {
        setReviewDraft((current) => current ?? repairDraftForReview(pendingReview));
      }
    }
    window.setTimeout(() => void checkForUpdates(true), 2500);
  }

  function schedulePendingReviewFallback() {
    if (pendingReviewFallbackTimerRef.current) {
      window.clearTimeout(pendingReviewFallbackTimerRef.current);
    }
    pendingReviewFallbackTimerRef.current = window.setTimeout(() => {
      void openLatestPendingReview();
    }, 900);
  }

  function showCapturePrompt(nextHealth: CaptureHealth, message: string) {
    const signature = `${nextHealth.platform}|${nextHealth.state}|${nextHealth.lastEventAt ?? ""}|${message}`;
    if (capturePromptSignatureRef.current === signature) {
      return;
    }
    capturePromptSignatureRef.current = signature;
    showActionFeedback(message, 4500);
  }

  async function openLatestPendingReview() {
    const [nextSettings, nextMatches] = await Promise.all([
      window.riftlite.getSettings(),
      window.riftlite.getMatches()
    ]);
    setSettings(nextSettings);
    setMatches(nextMatches);
    if (!nextSettings.confirmationEnabled) {
      return;
    }
    const pendingReview = latestPendingReviewMatch(nextMatches);
    if (!pendingReview) {
      return;
    }
    setReviewDraft((current) => current && current.status !== "saved" ? current : repairDraftForReview(pendingReview));
  }

  async function forceCaptureReview() {
    showActionFeedback("Opening review from retained capture data...");
    const draft = await window.riftlite.forceCaptureReview(activePlatform);
    if (!draft) {
      await openLatestPendingReview();
      showActionFeedback(`No active ${activePlatform === "tcga" ? "TCGA" : "Atlas"} capture data to force yet.`);
      return;
    }
    const repairedDraft = repairDraftForReview(draft);
    clearDismissedReview(repairedDraft);
    setReviewDraft(repairedDraft);
    setMatches((current) => upsertMatchPreservingOrder(current, repairedDraft));
    showActionFeedback("Review popup opened.");
  }

  function dismissReviewDraft() {
    if (reviewDraft) {
      markReviewDismissed(reviewDraft);
    }
    setReviewDraft(null);
  }

  function scheduleDiagnosticsRefresh(delayMs = 900, force = false) {
    if (!force && activeViewRef.current !== "settings") {
      return;
    }
    if (diagnosticsRefreshTimerRef.current) {
      return;
    }
    diagnosticsRefreshTimerRef.current = window.setTimeout(() => {
      diagnosticsRefreshTimerRef.current = undefined;
      void refreshDiagnostics();
    }, delayMs);
  }

  async function refreshDiagnostics() {
    if (diagnosticsRefreshInFlightRef.current) {
      return;
    }
    diagnosticsRefreshInFlightRef.current = true;
    try {
      setDiagnosticsSummary(await window.riftlite.getDiagnosticsSummary());
    } finally {
      diagnosticsRefreshInFlightRef.current = false;
    }
  }

  async function createDiagnosticsBundle() {
    showActionFeedback("Creating diagnostics bundle...");
    const bundlePath = await window.riftlite.createDiagnosticsBundle();
    setDiagnosticsBundlePath(bundlePath);
    await refreshDiagnostics();
    showActionFeedback("Diagnostics bundle created.");
  }

  async function checkForUpdates(silent = false) {
    if (!silent) {
      setUpdateStatus((current) => ({ ...current, state: "checking", message: "Checking for updates..." }));
      showActionFeedback("Checking for updates...");
    }
    const result = await window.riftlite.checkForUpdates();
    setUpdateStatus(result);
    if (!silent || result.state === "available" || result.state === "downloaded") {
      showActionFeedback(result.message);
    }
  }

  async function downloadUpdate() {
    setUpdatePromptDismissedFor("");
    setUpdateStatus((current) => ({ ...current, state: "downloading", message: "Starting update download..." }));
    showActionFeedback("Starting update download...");
    const result = await window.riftlite.downloadUpdate();
    setUpdateStatus(result);
    showActionFeedback(result.message);
  }

  async function installUpdate() {
    setUpdatePromptDismissedFor("");
    showActionFeedback("Installing update...");
    await window.riftlite.installUpdate();
  }

  async function saveSettings(patch: Partial<UserSettings>) {
    const next = await window.riftlite.saveSettings(patch);
    setSettings(next);
    if (patch.activeHubs || typeof patch.communitySyncEnabled === "boolean" || patch.syncMode) {
      communityLoadedRef.current = false;
      if (activeViewRef.current === "community" || activeViewRef.current === "hubs") {
        void refreshCommunityData(next);
      }
    }
  }

  async function confirmDraft(draft: MatchDraft) {
    const saved = await window.riftlite.confirmMatch(normalizeReviewDraft(draft));
    if (draft.keepReplay === false) {
      await window.riftlite.deleteReplayVideoByMatch(draft.id).catch(() => undefined);
    }
    setReviewDraft(null);
    setMatches((current) => upsertMatchPreservingOrder(current, saved));
    setReplays(await window.riftlite.getReplays());
    setDeletedReplays(await window.riftlite.getDeletedReplays());
    setDecks(await window.riftlite.getDecks());
  }

  async function refreshDecks() {
    const [nextDecks, nextSettings] = await Promise.all([
      window.riftlite.getDecks(),
      window.riftlite.getSettings()
    ]);
    setDecks(nextDecks);
    setSettings(nextSettings);
  }

  async function refreshReplays(focusReplayId = "") {
    const [nextReplays, nextDeletedReplays] = await Promise.all([
      window.riftlite.getReplays(),
      window.riftlite.getDeletedReplays()
    ]);
    setReplays(nextReplays);
    setDeletedReplays(nextDeletedReplays);
    if (focusReplayId) {
      setFocusedReplayId(focusReplayId);
    }
  }

  async function deleteReplay(id: string) {
    await window.riftlite.deleteReplay(id);
    await refreshReplays();
    await refreshDeletedItems();
  }

  function openReplayForMatch(matchId: string) {
    const replay = replays.find((item) => item.matchId === matchId);
    if (!replay) {
      showActionFeedback("No replay is linked to this match yet.");
      return;
    }
    setFocusedReplayId(replay.id);
    setActiveView("replays");
  }

  async function saveHubResult(result: HubActionResult) {
    setSettings(result.settings);
    await refreshCommunityData(result.settings, true);
  }

  async function syncPrivateHubsNow(): Promise<PrivateHubSyncResult> {
    const result = await window.riftlite.syncPrivateHubs();
    const [nextMatches, nextSettings] = await Promise.all([
      window.riftlite.getMatches(),
      window.riftlite.getSettings()
    ]);
    setMatches(nextMatches);
    setSettings(nextSettings);
    await refreshCommunityData(nextSettings, true);
    return result;
  }

  async function syncMatchesToHubs(matchIds: string[], hubIds: string[]): Promise<PrivateHubSyncResult> {
    const result = await window.riftlite.syncMatchesToHubs(matchIds, hubIds);
    const [nextMatches, nextSettings] = await Promise.all([
      window.riftlite.getMatches(),
      window.riftlite.getSettings()
    ]);
    setMatches(nextMatches);
    setSettings(nextSettings);
    await refreshCommunityData(nextSettings, true);
    return result;
  }

  async function deleteHubMatch(hubId: string, matchId: string): Promise<void> {
    await window.riftlite.deleteHubMatch(hubId, matchId);
    setMatches(await window.riftlite.getMatches());
    await refreshCommunityData(settings, true);
  }

  async function refreshDeletedItems() {
    const [nextDeletedMatches, nextDeletedReplays] = await Promise.all([
      window.riftlite.getDeletedMatches(),
      window.riftlite.getDeletedReplays()
    ]);
    setDeletedMatches(nextDeletedMatches);
    setDeletedReplays(nextDeletedReplays);
  }

  async function restoreDeletedMatch(id: string) {
    await window.riftlite.restoreMatch(id);
    const [nextMatches, nextReplays] = await Promise.all([
      window.riftlite.getMatches(),
      window.riftlite.getReplays()
    ]);
    setMatches(nextMatches);
    setReplays(nextReplays);
    await refreshDeletedItems();
  }

  async function purgeDeletedMatch(id: string) {
    await window.riftlite.purgeMatch(id);
    await refreshDeletedItems();
  }

  async function restoreDeletedReplay(id: string) {
    await window.riftlite.restoreReplay(id);
    await refreshReplays();
    await refreshDeletedItems();
  }

  async function purgeDeletedReplay(id: string) {
    await window.riftlite.purgeReplay(id);
    await refreshDeletedItems();
  }

  async function refreshCommunityData(sourceSettings = settings, forceRefresh = false) {
    if (!sourceSettings) {
      return;
    }
    communityLoadedRef.current = true;
    setCommunityStatus("Refreshing Firebase data...");
    const [nextCommunityMatches, hubEntries] = await Promise.all([
      window.riftlite.getCommunityMatches(forceRefresh).catch(() => [] as CommunityMatch[]),
      Promise.all(sourceSettings.activeHubs.map(async (hub) => [
        hub.id,
        await window.riftlite.getHubMatches(hub.id, forceRefresh).catch(() => [] as CommunityMatch[])
      ] as const))
    ]);
    setCommunityMatches(nextCommunityMatches);
    setHubMatches(Object.fromEntries(hubEntries));
    setCommunityStatus(`Loaded ${nextCommunityMatches.length} community-submitted matches`);
  }

  async function importLegacyData() {
    const summary = await window.riftlite.importLegacyData();
    setImportSummary(summary);
    const [nextSettings, nextMatches, nextReplays, nextDeletedMatches, nextDeletedReplays] = await Promise.all([
      window.riftlite.getSettings(),
      window.riftlite.getMatches(),
      window.riftlite.getReplays(),
      window.riftlite.getDeletedMatches(),
      window.riftlite.getDeletedReplays()
    ]);
    setSettings(nextSettings);
    setMatches(nextMatches);
    setReplays(nextReplays);
    setDeletedMatches(nextDeletedMatches);
    setDeletedReplays(nextDeletedReplays);
    await refreshCommunityData(nextSettings, true);
  }

  async function takeScreenshot() {
    setScreenshotStatus("Taking screenshot...");
    showActionFeedback("Taking screenshot...");
    const result = await window.riftlite.takeScreenshot();
    const message = result.ok ? result.message : `Screenshot failed: ${result.message}`;
    setScreenshotStatus(message);
    showActionFeedback(message);
  }

  async function chooseScreenshotDirectory() {
    showActionFeedback("Choosing screenshot folder...");
    const next = await window.riftlite.chooseScreenshotDirectory();
    setSettings(next);
    showActionFeedback(next.screenshotDirectory ? "Screenshot folder updated." : "Using default screenshot folder.");
  }

  async function openScreenshotDirectory() {
    showActionFeedback("Opening screenshot folder...");
    await window.riftlite.openScreenshotDirectory();
  }

  function showActionFeedback(message: string, durationMs = 2600) {
    setActionFeedback(message);
    if (actionFeedbackTimerRef.current) {
      window.clearTimeout(actionFeedbackTimerRef.current);
    }
    actionFeedbackTimerRef.current = window.setTimeout(() => {
      setActionFeedback("");
      actionFeedbackTimerRef.current = undefined;
    }, durationMs);
  }

  function applyGameZoom(zoom = gameZoom) {
    const webview = gameRef.current;
    if (!webview) {
      return;
    }
    try {
      webview.setZoomFactor(clampGameZoom(zoom));
    } catch {
      // The webview can be between navigations; the next ready event reapplies the saved zoom.
    }
  }

  function reloadGamePage(hardRefresh = false) {
    const webview = gameRef.current as (Electron.WebviewTag & { reloadIgnoringCache?: () => void }) | null;
    if (!webview) {
      showActionFeedback("Game page is not ready yet.");
      return;
    }
    try {
      if (hardRefresh && typeof webview.reloadIgnoringCache === "function") {
        webview.reloadIgnoringCache();
      } else {
        webview.reload();
      }
      showActionFeedback(hardRefresh ? "Hard refreshing game page..." : "Refreshing game page...");
    } catch {
      showActionFeedback("Refresh failed. Try switching tabs and back.");
    }
  }

  async function setGameZoom(nextZoom: number) {
    const zoom = clampGameZoom(nextZoom);
    applyGameZoom(zoom);
    await saveSettings({ gameZoomFactor: zoom });
    showActionFeedback(`Game zoom set to ${Math.round(zoom * 100)}%.`);
  }

  async function handleWebviewIpc(event: { channel?: string; args?: unknown[] }) {
    if (event.channel !== "capture:event") {
      return;
    }
    const payload = event.args?.[0];
    if (!payload || typeof payload !== "object") {
      return;
    }
    await window.riftlite.reportRendererEvent(payload as CaptureEvent);
  }

  async function primeReplayVideoTarget(platform: GamePlatform = activePlatform): Promise<void> {
    const currentSettings = settingsRef.current;
    const mode = currentSettings?.replayVideoMode || "game-frame";
    if (
      !currentSettings?.replayCaptureEnabled ||
      !currentSettings.replayVideoEnabled
    ) {
      return;
    }
    await window.riftlite.prepareReplayVideoCaptureTarget(platform, mode);
  }

  function reportReplayVideoDebug(platform: GamePlatform, reason: string, details: Record<string, unknown> = {}): void {
    const capturedAt = new Date().toISOString();
    void window.riftlite.reportRendererEvent({
      id: `${platform}-replay-video-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
      platform,
      kind: "debug",
      capturedAt,
      url: GAME_URLS[platform],
      payload: {
        reason: `replay-video-${reason}`,
        activeView: activeViewRef.current,
        ...details
      }
    });
  }

  function stopReplaySource(source: SystemWindowReplaySource | undefined): void {
    source?.stream.getTracks().forEach((track) => track.stop());
    if (source?.video) {
      source.video.pause();
      source.video.srcObject = null;
    }
  }

  function stopArmedReplaySources(): void {
    for (const armed of Object.values(armedReplayVideoRef.current)) {
      stopReplaySource(armed?.source);
    }
    armedReplayVideoRef.current = {};
  }

  function takeArmedReplaySource(
    platform: GamePlatform,
    mode: ReplayVideoCaptureMode,
    quality: ReplayVideoQuality
  ): SystemWindowReplaySource | null {
    const armed = armedReplayVideoRef.current[platform];
    if (!armed || armed.mode !== mode || armed.quality !== quality) {
      return null;
    }
    if (!armed.source.stream.getVideoTracks().some((track) => track.readyState === "live")) {
      delete armedReplayVideoRef.current[platform];
      return null;
    }
    delete armedReplayVideoRef.current[platform];
    return armed.source;
  }

  async function armReplayVideoSource(platform: GamePlatform = activePlatform, quiet = true): Promise<void> {
    const currentSettings = settingsRef.current;
    const mode = currentSettings?.replayVideoMode || "game-frame";
    if (
      !currentSettings?.replayCaptureEnabled ||
      !currentSettings.replayVideoEnabled ||
      replayVideoRef.current
    ) {
      return;
    }
    const quality = currentSettings.replayVideoQuality || "sharp";
    const current = armedReplayVideoRef.current[platform];
    if (
      current?.mode === mode &&
      current.quality === quality &&
      current.source.stream.getVideoTracks().some((track) => track.readyState === "live")
    ) {
      return;
    }
    const now = Date.now();
    if (now - lastReplayArmAttemptRef.current < REPLAY_VIDEO_ARM_THROTTLE_MS) {
      return;
    }
    lastReplayArmAttemptRef.current = now;
    const profile = REPLAY_VIDEO_PROFILES[quality] ?? REPLAY_VIDEO_PROFILES.sharp;
    let source = await prepareDisplayReplaySource(platform, mode, profile, { targetAlreadyPrepared: true });
    if (!source) {
      source = await prepareDisplayReplaySource(platform, mode, profile);
    }
    if (!source) {
      if (!quiet) {
        showActionFeedback("Video replay could not arm yet.");
      }
      reportReplayVideoDebug(platform, "arm-failed", { mode, quality });
      void primeReplayVideoTarget(platform);
      return;
    }
    stopReplaySource(current?.source);
    armedReplayVideoRef.current[platform] = {
      platform,
      mode,
      quality,
      source
    };
    if (!quiet) {
      showActionFeedback("Direct replay capture armed.");
    }
    reportReplayVideoDebug(platform, "armed", { mode, quality, source: source.source });
  }

  async function maybeStartReplayVideo(event: CaptureEvent) {
    const currentSettings = settingsRef.current;
    if (
      event.kind !== "match-start" ||
      replayVideoRef.current ||
      !currentSettings?.replayCaptureEnabled ||
      !currentSettings.replayVideoEnabled
    ) {
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      showActionFeedback("Video replay needs MediaRecorder support.");
      reportReplayVideoDebug(event.platform, "media-recorder-missing");
      return;
    }
    const quality = currentSettings.replayVideoQuality || "sharp";
    const profile = REPLAY_VIDEO_PROFILES[quality] ?? REPLAY_VIDEO_PROFILES.sharp;
    let mode: ReplayVideoCaptureMode = currentSettings.replayVideoMode || "game-frame";
    let displaySource: SystemWindowReplaySource | null = takeArmedReplaySource(event.platform, mode, quality);
    displaySource = displaySource ?? await prepareDisplayReplaySource(event.platform, mode, profile);
    if (!displaySource && mode === "game-frame") {
      displaySource = await prepareDisplayReplaySource(event.platform, "system-window", profile);
      if (displaySource) {
        mode = "system-window";
        showActionFeedback("Direct game replay unavailable; using window crop.");
      }
    }
    if (!displaySource) {
      showActionFeedback("Video replay was not armed, so it was skipped to keep gameplay smooth.");
      reportReplayVideoDebug(event.platform, "start-source-missing", { mode, quality });
      void primeReplayVideoTarget(event.platform);
      return;
    }
    const recorderFormats = supportedReplayVideoFormats();
    if (!recorderFormats.length) {
      displaySource.stream.getTracks().forEach((track) => track.stop());
      showActionFeedback("Video replay needs MediaRecorder video support.");
      reportReplayVideoDebug(event.platform, "recorder-format-missing", { mode, quality, source: displaySource.source });
      return;
    }
    let canvas: HTMLCanvasElement | undefined;
    let context: CanvasRenderingContext2D | undefined;
    let stream: MediaStream;
    let sourceStream: MediaStream | undefined;
    let sourceVideo: ReplaySourceVideoElement | undefined;
    let source: ReplayVideoFinalizeOptions["source"];
    let width = displaySource?.width ?? profile.width;
    let height = displaySource?.height ?? profile.height;

    if (displaySource?.source === "game-frame-direct") {
      stream = displaySource.stream;
      sourceStream = displaySource.stream;
      source = "game-frame-direct";
    } else {
      canvas = document.createElement("canvas");
      canvas.width = profile.width;
      canvas.height = profile.height;
      context = canvas.getContext("2d", { alpha: false, desynchronized: true } as CanvasRenderingContext2DSettings) ?? undefined;
      if (!context) {
        displaySource.stream.getTracks().forEach((track) => track.stop());
        reportReplayVideoDebug(event.platform, "canvas-context-missing", { mode, quality, source: displaySource.source });
        return;
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "low";
      stream = canvas.captureStream(profile.fps);
      width = profile.width;
      height = profile.height;
      sourceStream = displaySource.stream;
      sourceVideo = displaySource.video;
      source = "system-window-crop";
    }
    let recorder: MediaRecorder | null = null;
    let recorderFormat: ReplayRecorderFormat | null = null;
    for (const candidate of recorderFormats) {
      try {
        recorder = new MediaRecorder(stream, {
          mimeType: candidate.recorderMimeType,
          bitsPerSecond: profile.bitrateKbps * 1000,
          videoBitsPerSecond: profile.bitrateKbps * 1000
        });
        recorderFormat = candidate;
        break;
      } catch {
        recorder = null;
      }
    }
    if (!recorder || !recorderFormat) {
      sourceStream?.getTracks().forEach((track) => track.stop());
      if (stream !== sourceStream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      showActionFeedback("Video replay could not create a recorder.");
      reportReplayVideoDebug(event.platform, "recorder-create-failed", { mode, quality, source });
      return;
    }
    const session = await window.riftlite.startReplayVideoCapture({
      platform: event.platform,
      title: `${event.platform}-${event.capturedAt}`,
      quality,
      mimeType: recorderFormat.fileMimeType
    });
    const runtime: ReplayVideoRuntime = {
      session,
      platform: event.platform,
      mode,
      source,
      profile,
      quality,
      fileMimeType: recorderFormat.fileMimeType,
      codec: recorderFormat.codec,
      canvas,
      context,
      recorder,
      stream,
      width,
      height,
      timer: 0,
      sourceStream,
      sourceVideo,
      videoFrameCallbackId: undefined,
      cropCache: undefined,
      startedAt: session.startedAt,
      startedMs: Date.now(),
      pendingWrites: [],
      frameCount: 0,
      lastDrawAt: 0,
      nextAllowedAt: mode === "system-window" ? 0 : Date.now() + 1000,
      slowCaptureStreak: 0,
      lastCaptureMs: 0
    };
    recorder.ondataavailable = (chunkEvent) => {
      if (!chunkEvent.data.size) {
        return;
      }
      const pending = chunkEvent.data
        .arrayBuffer()
        .then((buffer) => window.riftlite.appendReplayVideoChunk(session.id, buffer))
        .catch(() => undefined);
      runtime.pendingWrites.push(pending);
      pending.finally(() => {
        runtime.pendingWrites = runtime.pendingWrites.filter((item) => item !== pending);
      });
    };
    replayVideoRef.current = runtime;
    recorder.start(5000);
    if (runtime.source === "system-window-crop") {
      drawSystemWindowReplayFrame(runtime);
      scheduleSystemWindowReplayFrame(runtime);
    }
    const modeLabel = runtime.source === "game-frame-direct"
      ? "direct game frame"
      : "window crop";
    showActionFeedback(`Video replay started (${profile.label}, ${modeLabel}).`);
    reportReplayVideoDebug(event.platform, "started", { mode, quality, source: runtime.source, codec: runtime.codec });
  }

  async function prepareDisplayReplaySource(
    platform: GamePlatform,
    mode: Extract<ReplayVideoCaptureMode, "game-frame" | "system-window">,
    profile: typeof REPLAY_VIDEO_PROFILES[ReplayVideoQuality],
    options: { targetAlreadyPrepared?: boolean } = {}
  ): Promise<SystemWindowReplaySource | null> {
    if (mode === "system-window") {
      return prepareSystemWindowReplaySource(platform, profile);
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      reportReplayVideoDebug(platform, "display-media-missing", { mode });
      return null;
    }
    try {
      if (!options.targetAlreadyPrepared) {
        await window.riftlite.prepareReplayVideoCaptureTarget(platform, mode);
      }
      const sourceStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: profile.fps, max: profile.fps },
          width: { ideal: profile.width },
          height: { ideal: profile.height }
        },
        audio: false
      });
      const track = sourceStream.getVideoTracks()[0];
      if (!track) {
        sourceStream.getTracks().forEach((item) => item.stop());
        reportReplayVideoDebug(platform, "display-track-missing", { mode });
        return null;
      }
      try {
        (track as MediaStreamTrack & { contentHint?: string }).contentHint = "detail";
      } catch {
        // Best effort: Chromium uses this hint when available to favour readable card detail.
      }
      await track.applyConstraints({
        width: { max: profile.width },
        height: { max: profile.height },
        frameRate: { max: profile.fps }
      }).catch(() => undefined);
      const settings = track.getSettings();
      const width = typeof settings.width === "number" && settings.width > 0 ? settings.width : profile.width;
      const height = typeof settings.height === "number" && settings.height > 0 ? settings.height : profile.height;
      return {
        stream: sourceStream,
        width,
        height,
        source: "game-frame-direct"
      };
    } catch (error) {
      reportReplayVideoDebug(platform, "display-source-error", {
        mode,
        targetAlreadyPrepared: Boolean(options.targetAlreadyPrepared),
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : ""
      });
      return null;
    }
  }

  async function prepareSystemWindowReplaySource(
    platform: GamePlatform,
    profile: typeof REPLAY_VIDEO_PROFILES[ReplayVideoQuality]
  ): Promise<SystemWindowReplaySource | null> {
    if (!navigator.mediaDevices?.getUserMedia) {
      reportReplayVideoDebug(platform, "window-user-media-missing");
      return null;
    }
    try {
      const captureSource = await window.riftlite.getReplayWindowCaptureSource();
      if (!captureSource) {
        reportReplayVideoDebug(platform, "window-source-missing");
        return null;
      }
      const sourceStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: captureSource.id,
            maxWidth: profile.width,
            maxHeight: profile.height,
            maxFrameRate: profile.fps
          }
        }
      } as unknown as MediaStreamConstraints);
      const track = sourceStream.getVideoTracks()[0];
      if (!track) {
        sourceStream.getTracks().forEach((item) => item.stop());
        reportReplayVideoDebug(platform, "window-track-missing", { sourceName: captureSource.name });
        return null;
      }
      try {
        (track as MediaStreamTrack & { contentHint?: string }).contentHint = "detail";
      } catch {
        // Best effort only.
      }
      const video = document.createElement("video") as ReplaySourceVideoElement;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = sourceStream;
      await video.play();
      if (!video.videoWidth || !video.videoHeight) {
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          video.addEventListener("loadedmetadata", done, { once: true });
          window.setTimeout(done, 500);
        });
      }
      reportReplayVideoDebug(platform, "window-source-ready", { sourceName: captureSource.name });
      return {
        stream: sourceStream,
        video,
        width: profile.width,
        height: profile.height,
        source: "system-window-crop"
      };
    } catch (error) {
      reportReplayVideoDebug(platform, "window-source-error", {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : ""
      });
      return null;
    }
  }

  function scheduleSystemWindowReplayFrame(runtime: ReplayVideoRuntime): void {
    const video = runtime.sourceVideo;
    if (!video || runtime.recorder.state === "inactive") {
      return;
    }
    if (video.requestVideoFrameCallback) {
      runtime.videoFrameCallbackId = video.requestVideoFrameCallback(() => {
        drawSystemWindowReplayFrame(runtime);
        scheduleSystemWindowReplayFrame(runtime);
      });
      return;
    }
    if (!runtime.timer) {
      runtime.timer = window.setInterval(() => {
        drawSystemWindowReplayFrame(runtime);
      }, Math.max(SYSTEM_REPLAY_FRAME_MIN_MS, Math.floor(1000 / Math.max(1, runtime.profile.fps))));
    }
  }

  function systemReplayCrop(runtime: ReplayVideoRuntime, video: HTMLVideoElement): SystemReplayCrop | null {
    const frame = document.querySelector<HTMLElement>(".game-frame");
    const rect = frame?.getBoundingClientRect();
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    if (!rect || rect.width < 32 || rect.height < 32) {
      return null;
    }
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const outerWidth = Math.max(viewportWidth, window.outerWidth || viewportWidth);
    const outerHeight = Math.max(viewportHeight, window.outerHeight || viewportHeight);
    const cacheKey = [
      sourceWidth,
      sourceHeight,
      viewportWidth,
      viewportHeight,
      outerWidth,
      outerHeight,
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height)
    ].join(":");
    const now = Date.now();
    if (runtime.cropCache?.cacheKey === cacheKey && runtime.cropCache.expiresAt > now) {
      return runtime.cropCache;
    }
    const sourceAspect = sourceWidth / Math.max(1, sourceHeight);
    const innerAspect = viewportWidth / Math.max(1, viewportHeight);
    const outerAspect = outerWidth / Math.max(1, outerHeight);
    const capturesNativeFrame = Math.abs(sourceAspect - outerAspect) + 0.01 < Math.abs(sourceAspect - innerAspect);
    const horizontalFrame = capturesNativeFrame ? Math.max(0, (outerWidth - viewportWidth) / 2) : 0;
    const topFrame = capturesNativeFrame ? Math.max(0, outerHeight - viewportHeight - horizontalFrame) : 0;
    const basisWidth = capturesNativeFrame ? outerWidth : viewportWidth;
    const basisHeight = capturesNativeFrame ? outerHeight : viewportHeight;
    const sx = Math.max(0, Math.min(sourceWidth - 1, ((rect.left + horizontalFrame) / basisWidth) * sourceWidth));
    const sy = Math.max(0, Math.min(sourceHeight - 1, ((rect.top + topFrame) / basisHeight) * sourceHeight));
    const sw = Math.max(1, Math.min(sourceWidth - sx, (rect.width / basisWidth) * sourceWidth));
    const sh = Math.max(1, Math.min(sourceHeight - sy, (rect.height / basisHeight) * sourceHeight));
    runtime.cropCache = {
      sx,
      sy,
      sw,
      sh,
      cacheKey,
      expiresAt: now + SYSTEM_REPLAY_CROP_CACHE_MS
    };
    return runtime.cropCache;
  }

  function drawSystemWindowReplayFrame(runtime: ReplayVideoRuntime): void {
    if (runtime.source !== "system-window-crop" || runtime.recorder.state === "inactive" || !runtime.context || !runtime.canvas) {
      return;
    }
    const now = Date.now();
    if (runtime.nextAllowedAt > now) {
      return;
    }
    const minFrameGap = Math.max(SYSTEM_REPLAY_FRAME_MIN_MS, Math.floor(1000 / Math.max(1, runtime.profile.fps)));
    if (runtime.lastDrawAt && now - runtime.lastDrawAt < minFrameGap) {
      return;
    }
    const started = performance.now();
    const video = runtime.sourceVideo;
    try {
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
        return;
      }
      if (activeViewRef.current !== "play") {
        return;
      }
      const crop = systemReplayCrop(runtime, video);
      if (!crop) {
        return;
      }
      runtime.context.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, runtime.canvas.width, runtime.canvas.height);
      runtime.frameCount += 1;
      runtime.lastDrawAt = now;
    } finally {
      runtime.lastCaptureMs = performance.now() - started;
      if (runtime.lastCaptureMs > SYSTEM_REPLAY_SLOW_DRAW_MS) {
        runtime.slowCaptureStreak += 1;
        runtime.nextAllowedAt = Date.now() + Math.min(
          SYSTEM_REPLAY_MAX_BACKOFF_MS,
          SYSTEM_REPLAY_BACKOFF_STEP_MS * runtime.slowCaptureStreak
        );
      } else if (runtime.slowCaptureStreak > 0) {
        runtime.slowCaptureStreak -= 1;
        runtime.nextAllowedAt = 0;
      }
    }
  }

  async function stopReplayVideoForDraft(draft: MatchDraft | null): Promise<void> {
    const runtime = replayVideoRef.current;
    if (!runtime) {
      return;
    }
    replayVideoRef.current = null;
    window.clearInterval(runtime.timer);
    if (runtime.videoFrameCallbackId !== undefined && runtime.sourceVideo?.cancelVideoFrameCallback) {
      runtime.sourceVideo.cancelVideoFrameCallback(runtime.videoFrameCallbackId);
    }
    try {
      if (runtime.source === "system-window-crop") {
        drawSystemWindowReplayFrame(runtime);
      }
      const stopped = new Promise<void>((resolve) => {
        runtime.recorder.addEventListener("stop", () => resolve(), { once: true });
      });
      if (runtime.recorder.state !== "inactive") {
        runtime.recorder.requestData();
        runtime.recorder.stop();
      }
      await stopped;
      await Promise.allSettled(runtime.pendingWrites);
      runtime.sourceStream?.getTracks().forEach((track) => track.stop());
      if (runtime.sourceVideo) {
        runtime.sourceVideo.pause();
        runtime.sourceVideo.srcObject = null;
      }
      if (runtime.stream !== runtime.sourceStream) {
        runtime.stream.getTracks().forEach((track) => track.stop());
      }
      const endedAt = new Date().toISOString();
      const video = await window.riftlite.finishReplayVideoCapture(runtime.session.id, {
        platform: runtime.platform,
        startedAt: runtime.startedAt,
        endedAt,
        durationMs: Date.now() - runtime.startedMs,
        width: runtime.width,
        height: runtime.height,
        fps: runtime.profile.fps,
        captureIntervalMs: Math.round(1000 / Math.max(1, runtime.profile.fps)),
        bitrateKbps: runtime.profile.bitrateKbps,
        actualBitrateKbps: Math.round((runtime.recorder.videoBitsPerSecond || 0) / 1000) || undefined,
        codec: runtime.codec,
        quality: runtime.quality,
        mimeType: runtime.fileMimeType,
        source: runtime.source
      });
      if (draft) {
        if (draft.keepReplay === false) {
          await window.riftlite.discardReplayVideo(video).catch(() => undefined);
          showActionFeedback("Video replay discarded for this match.");
          return;
        }
        const saved = await window.riftlite.attachReplayVideo(draft.id, video);
        if (saved) {
          setReplays(await window.riftlite.getReplays());
          showActionFeedback(`Video replay attached (${formatBytes(video.sizeBytes)}).`);
        }
      }
    } catch {
      showActionFeedback("Video replay stopped, but the video could not be attached.");
    }
  }

  const sessionStats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todayMatches = matches.filter((match) => match.capturedAt.startsWith(today));
    return {
      total: todayMatches.length,
      wins: todayMatches.filter((match) => match.result === "Win").length,
      losses: todayMatches.filter((match) => match.result === "Loss").length
    };
  }, [matches]);

  const viewTitle = {
    play: "Play",
    scorepad: "Scorepad",
    matches: "Matches",
    stats: "Stats",
    spotlight: "Spotlight",
    community: "Community",
    hubs: "Private hubs",
    decks: "Decks",
    replays: "Replays",
    stream: "Stream",
    settings: "Settings"
  }[activeView];

  const viewDescription = {
    play: "Embedded capture is active automatically for TCGA and Atlas.",
    scorepad: "Score table games or quick-log event matches without sending them to public community stats.",
    matches: "Review, correct, and track locally captured matches.",
    stats: "Personal performance from local RiftLite history.",
    spotlight: "Featured Riftbound creators, teams, and community projects.",
    community: "Community data remains compatible with the existing RiftLite website.",
    hubs: "Private hub sync uses hidden hub names and passwords, just like the current app.",
    decks: "Import, refresh, and attach decks to captured matches.",
    replays: "Review Atlas timelines reconstructed from retained capture evidence.",
    stream: "OBS-friendly local overlay for session score and latest match.",
    settings: "Privacy, sync, browser support, and capture behaviour."
  }[activeView];

  if (!settings) {
    return <div className="loading">Starting RiftLite v{APP_VERSION_META}</div>;
  }

  const Webview = "webview" as unknown as React.ElementType;
  const updatePromptKey = `${updateStatus.state}:${updateStatus.latestVersion ?? updateStatus.currentVersion}`;
  const showUpdatePrompt =
    (updateStatus.state === "available" || updateStatus.state === "downloading" || updateStatus.state === "downloaded") &&
    updatePromptDismissedFor !== updatePromptKey;

  return (
    <main
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      onPointerDownCapture={() => {
        if (activeViewRef.current === "play") {
          void armReplayVideoSource(activePlatform, true);
        }
      }}
    >
      <button
        type="button"
        className="sidebar-float-toggle"
        title={sidebarCollapsed ? "Show navigation" : "Hide navigation"}
        aria-label={sidebarCollapsed ? "Show navigation" : "Hide navigation"}
        onClick={() => setSidebarCollapsed((current) => !current)}
      >
        {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
      </button>
      <aside className="sidebar">
        <div className="brand">
          {logoUrl ? <img src={logoUrl} alt="RiftLite" /> : <div className="brand-mark" />}
          <span className="brand-version">v{APP_VERSION_META}</span>
          <div>
            <strong>RiftLite</strong>
            <span>Beta 0.7 replay tools</span>
          </div>
        </div>
        <nav>
          <NavButton active={activeView === "play"} title="Play" onClick={() => setActiveView("play")} icon={<Play size={18} />} />
          <NavButton active={activeView === "matches"} title="Matches" onClick={() => setActiveView("matches")} icon={<ClipboardList size={18} />} />
          <NavButton active={activeView === "stats"} title="Stats" onClick={() => setActiveView("stats")} icon={<BarChart3 size={18} />} />
          <NavButton active={activeView === "spotlight"} title="Spotlight" onClick={() => setActiveView("spotlight")} icon={<Compass size={18} />} />
          <NavButton active={activeView === "community"} title="Community" onClick={() => setActiveView("community")} icon={<Globe2 size={18} />} />
          <NavButton active={activeView === "hubs"} title="Hubs" onClick={() => setActiveView("hubs")} icon={<Users size={18} />} />
          <NavButton active={activeView === "decks"} title="Decks" onClick={() => setActiveView("decks")} icon={<Layers size={18} />} />
          <NavButton active={activeView === "replays"} title="Replays" onClick={() => setActiveView("replays")} icon={<Film size={18} />} />
          <NavButton active={activeView === "stream"} title="Stream" onClick={() => setActiveView("stream")} icon={<MonitorUp size={18} />} />
          <NavButton active={activeView === "settings"} title="Settings" onClick={() => setActiveView("settings")} icon={<Settings size={18} />} />
        </nav>
        <div className="sidebar-footer">
          <SidebarScorepadButton active={activeView === "scorepad"} onClick={() => setActiveView("scorepad")} />
          <SidebarZoomMenu zoom={gameZoom} onZoomChange={(zoom) => void setGameZoom(zoom)} />
          <SidebarResourceMenu />
          <CaptureHealthPanel health={health} />
        </div>
      </aside>

      <section className="workspace">
        <header className={`topbar ${activeView === "play" ? "play-topbar" : ""}`}>
          <div>
            <h1>{viewTitle}</h1>
            <p>{viewDescription}</p>
          </div>
          <div className="top-actions" data-hidden={activeView !== "play"}>
            <button className="segmented" onClick={() => setActivePlatform("tcga")} data-active={activePlatform === "tcga"}>
              <Gamepad2 size={16} /> TCGA
            </button>
            <button className="segmented" onClick={() => setActivePlatform("atlas")} data-active={activePlatform === "atlas"}>
              <Gamepad2 size={16} /> Atlas
            </button>
            <button
              className="segmented icon-segment"
              onClick={() => reloadGamePage(false)}
              title="Refresh game page"
            >
              <RefreshCw size={16} />
            </button>
            <button
              className="segmented icon-segment"
              onClick={() => reloadGamePage(true)}
              title="Hard refresh game page"
            >
              <RotateCcw size={16} />
            </button>
            <button
              className="segmented icon-segment"
              onClick={() => void takeScreenshot()}
              title={`Save screenshot${settings.screenshotHotkeyEnabled && settings.screenshotHotkey ? ` (${settings.screenshotHotkey})` : ""}`}
            >
              <Camera size={16} />
            </button>
            <button className="segmented icon-segment" onClick={() => setDetailsOpen((open) => !open)} data-active={detailsOpen} title="Capture details">
              {detailsOpen ? <X size={16} /> : <SlidersHorizontal size={16} />}
            </button>
          </div>
        </header>

        {!settings.firstRunComplete && activeView === "play" ? (
          <FirstRun settings={settings} onSave={saveSettings} browsers={browsers} />
        ) : null}

        <section className={`play-grid ${activeView === "play" ? "" : "background-play-grid"}`} aria-hidden={activeView !== "play"}>
          <div className="game-frame">
            {preloadUrl ? (
              <Webview
                ref={gameRef}
                key={`${activePlatform}:${preloadUrl}`}
                className="game-webview"
                src={GAME_URLS[activePlatform]}
                preload={preloadUrl}
                allowpopups="true"
                partition={`persist:riftlite-${activePlatform}`}
                webpreferences="backgroundThrottling=false"
                onFocus={() => void armReplayVideoSource(activePlatform, true)}
                onMouseEnter={() => void primeReplayVideoTarget(activePlatform)}
                onDomReady={() => {
                  applyGameZoom();
                  void primeReplayVideoTarget(activePlatform);
                }}
                onDidFinishLoad={() => {
                  applyGameZoom();
                  void primeReplayVideoTarget(activePlatform);
                }}
                onIpcMessage={(event: { channel?: string; args?: unknown[] }) => void handleWebviewIpc(event)}
              />
            ) : (
              <div className="game-placeholder">Preparing capture bridge</div>
            )}
          </div>
          <aside className={`right-rail ${detailsOpen ? "open" : ""}`} aria-hidden={!detailsOpen}>
            <SessionCard stats={sessionStats} matches={matches} />
            <SyncCard settings={settings} onSave={saveSettings} onForceReview={forceCaptureReview} />
          </aside>
        </section>

        {activeView !== "play" ? (
          <DashboardView
            view={activeView}
            matches={matches}
            replays={replays}
            deletedMatches={deletedMatches}
            deletedReplays={deletedReplays}
            decks={decks}
            battlefields={battlefields}
            communityMatches={communityMatches}
            hubMatches={hubMatches}
            communityStatus={communityStatus}
            importSummary={importSummary}
            settings={settings}
            browsers={browsers}
            overlayInfo={overlayInfo}
            diagnosticsPath={diagnosticsPath}
            diagnosticsSummary={diagnosticsSummary}
            diagnosticsBundlePath={diagnosticsBundlePath}
            updateStatus={updateStatus}
            screenshotStatus={screenshotStatus}
            onSaveSettings={saveSettings}
            onDecksChanged={refreshDecks}
            onSaveHubResult={saveHubResult}
            onSyncPrivateHubs={syncPrivateHubsNow}
            onSyncMatchesToHubs={syncMatchesToHubs}
            onDeleteHubMatch={deleteHubMatch}
            onRefreshCommunity={() => refreshCommunityData(settings, true)}
            onImportLegacy={importLegacyData}
            onTakeScreenshot={takeScreenshot}
            onChooseScreenshotDirectory={chooseScreenshotDirectory}
            onOpenScreenshotDirectory={openScreenshotDirectory}
            onRefreshDiagnostics={refreshDiagnostics}
            onCreateDiagnosticsBundle={createDiagnosticsBundle}
            onCheckUpdates={checkForUpdates}
            onDownloadUpdate={downloadUpdate}
            onInstallUpdate={installUpdate}
            onRestoreDeletedMatch={restoreDeletedMatch}
            onPurgeDeletedMatch={purgeDeletedMatch}
            onRestoreDeletedReplay={restoreDeletedReplay}
            onPurgeDeletedReplay={purgeDeletedReplay}
            onMatchesChanged={async () => {
              setMatches(await window.riftlite.getMatches());
            }}
            onReview={(draft) => setReviewDraft(repairDraftForReview(draft))}
            replayFocusId={focusedReplayId}
            onReplayFocusConsumed={() => setFocusedReplayId("")}
            onOpenReplayForMatch={openReplayForMatch}
            onReplaysChanged={refreshReplays}
            onDeleteReplay={deleteReplay}
            onDelete={async (id) => {
              await window.riftlite.deleteMatch(id);
              const [nextMatches, nextReplays, nextDeletedMatches, nextDeletedReplays] = await Promise.all([
                window.riftlite.getMatches(),
                window.riftlite.getReplays(),
                window.riftlite.getDeletedMatches(),
                window.riftlite.getDeletedReplays()
              ]);
              setMatches(nextMatches);
              setReplays(nextReplays);
              setDeletedMatches(nextDeletedMatches);
              setDeletedReplays(nextDeletedReplays);
            }}
          />
        ) : null}
      </section>

          {reviewDraft ? (
            <MatchReviewModal
              draft={reviewDraft}
              decks={decks}
              battlefields={battlefields}
              onClose={dismissReviewDraft}
              onConfirm={confirmDraft}
          onChange={setReviewDraft}
        />
      ) : null}
      {showUpdatePrompt ? (
        <UpdatePrompt
          status={updateStatus}
          onDownload={downloadUpdate}
          onInstall={installUpdate}
          onDismiss={() => setUpdatePromptDismissedFor(updatePromptKey)}
        />
      ) : null}
      {actionFeedback ? (
        <div className="action-feedback" role="status" aria-live="polite">
          <Check size={16} />
          <span>{actionFeedback}</span>
        </div>
      ) : null}
    </main>
  );
}

function UpdatePrompt({ status, onDownload, onInstall, onDismiss }: {
  status: UpdateStatus;
  onDownload: () => Promise<void>;
  onInstall: () => Promise<void>;
  onDismiss: () => void;
}) {
  const version = status.latestVersion ? `v${status.latestVersion}` : "a new version";
  const isDownloaded = status.state === "downloaded";
  const isDownloading = status.state === "downloading";
  return (
    <aside className="update-prompt" role="status" aria-live="polite">
      <Bell size={16} />
      <div>
        <strong>{isDownloaded ? "Update ready to install" : isDownloading ? "Downloading update" : `Update ${version} available`}</strong>
        <span>{isDownloading && typeof status.progress === "number" ? `${status.progress}% downloaded` : status.message}</span>
      </div>
      <div className="update-prompt-actions">
        {status.state === "available" ? <button type="button" className="secondary" onClick={() => void onDownload()}>Download</button> : null}
        {isDownloaded ? <button type="button" className="primary" onClick={() => void onInstall()}>Install</button> : null}
        <button type="button" className="icon-button" onClick={onDismiss} title="Dismiss update prompt" aria-label="Dismiss update prompt">
          <X size={15} />
        </button>
      </div>
    </aside>
  );
}

function NavButton({ active, title, icon, onClick }: { active: boolean; title: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} title={title} onClick={onClick}>
      {icon}<span>{title}</span>
    </button>
  );
}

function SidebarScorepadButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="sidebar-resource-button sidebar-scorepad-button"
      data-active={active}
      title="Scorepad"
      aria-label="Scorepad"
      onClick={onClick}
    >
      <Calculator size={18} />
    </button>
  );
}

function SidebarZoomMenu({ zoom, onZoomChange }: { zoom: number; onZoomChange: (zoom: number) => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const percent = Math.round(zoom * 100);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="sidebar-zoom-menu" ref={menuRef}>
      <button
        type="button"
        className="sidebar-resource-button sidebar-zoom-button"
        title={`Game zoom ${percent}%`}
        aria-label={`Game zoom ${percent}%`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ZoomIn size={18} />
      </button>
      {open ? (
        <div className="sidebar-resource-popover sidebar-zoom-popover">
          <strong>Game zoom</strong>
          <div className="sidebar-zoom-controls">
            <button
              type="button"
              className="secondary"
              onClick={() => onZoomChange(zoom - GAME_ZOOM_STEP)}
              disabled={zoom <= GAME_ZOOM_MIN + 0.001}
              aria-label="Zoom game out"
            >
              <ZoomOut size={15} />
            </button>
            <button type="button" className="secondary zoom-readout" onClick={() => onZoomChange(1)} title="Reset game zoom">
              {percent}%
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => onZoomChange(zoom + GAME_ZOOM_STEP)}
              disabled={zoom >= GAME_ZOOM_MAX - 0.001}
              aria-label="Zoom game in"
            >
              <ZoomIn size={15} />
            </button>
          </div>
          <span>Scales TCGA and Atlas only.</span>
        </div>
      ) : null}
    </div>
  );
}

function SidebarResourceMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="sidebar-resource-menu" ref={menuRef}>
      <button
        type="button"
        className="sidebar-resource-button"
        title="Community resources"
        aria-label="Community resources"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Compass size={18} />
      </button>
      {open ? (
        <div className="sidebar-resource-popover">
          <strong>Community</strong>
          {TOOLKIT_RESOURCES.map((resource) => {
            const Icon = resource.icon;
            return (
              <button
                type="button"
                className="sidebar-resource-link"
                key={resource.id}
                onClick={() => {
                  setOpen(false);
                  void window.riftlite.openExternalResource(resource.url);
                }}
              >
                <Icon size={16} />
                <span>{resource.label}</span>
                <ExternalLink size={13} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CaptureHealthPanel({ health }: { health: CaptureHealth }) {
  return (
    <div className="health-panel" data-state={health.state}>
      <div className="health-icon"><Activity size={18} /></div>
      <div>
        <strong>{healthLabel(health)}</strong>
        <span>{health.message}</span>
      </div>
    </div>
  );
}

function FirstRun({ settings, onSave, browsers }: { settings: UserSettings; onSave: (patch: Partial<UserSettings>) => Promise<void>; browsers: BrowserInfo[] }) {
  const [username, setUsername] = useState(settings.username);
  const installed = browsers.filter((browser) => browser.installed).map((browser) => browser.name).join(", ") || "none detected";

  return (
    <section className="first-run">
      <div>
        <h2>Quick setup</h2>
        <p>Pick your RiftLite username and default sync mode. You can change both later.</p>
      </div>
      <label>
        Username
        <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Usually your TCGA / Atlas name" />
      </label>
      <label>
        Sync mode
        <select
          value={settings.syncMode}
          onChange={(event) => void onSave(syncModePatch(event.target.value as UserSettings["syncMode"]))}
        >
          <option value="community-and-hubs">Community + private hubs</option>
          <option value="community-only">Community only</option>
          <option value="private-hubs-only">Private hubs only</option>
          <option value="local-only">Local only</option>
        </select>
      </label>
      <div className="setup-note"><Shield size={16} /> Installed browsers: {installed}</div>
      <button className="primary" onClick={() => void onSave({ username, firstRunComplete: true })}>
        <Check size={16} /> Start tracking
      </button>
    </section>
  );
}

function SessionCard({ stats, matches }: { stats: { total: number; wins: number; losses: number }; matches: MatchDraft[] }) {
  const latest = matches[0];
  return (
    <section className="rail-card">
      <h2>Session</h2>
      <div className="session-score">
        <strong>{stats.wins}-{stats.losses}</strong>
        <span>{stats.total} today</span>
      </div>
      <div className="latest-match">
        <span>Last capture</span>
        <strong>{latest ? `${latest.result} vs ${latest.opponentName || "unknown"}` : "None yet"}</strong>
      </div>
    </section>
  );
}

function SyncCard({
  settings,
  onSave,
  onForceReview
}: {
  settings: UserSettings;
  onSave: (patch: Partial<UserSettings>) => Promise<void>;
  onForceReview: () => Promise<void>;
}) {
  return (
    <section className="rail-card">
      <h2>Sync</h2>
      <SyncModeControl settings={settings} onSave={onSave} compact />
      <label className="toggle-row">
        <span><Bell size={16} /> Confirm matches</span>
        <input
          type="checkbox"
          checked={settings.confirmationEnabled}
          onChange={(event) => void onSave({ confirmationEnabled: event.target.checked })}
        />
      </label>
      <button className="secondary force-review-button" type="button" onClick={() => void onForceReview()}>
        <FileText size={15} /> Force review popup
      </button>
      <p className="muted force-review-copy">Manual backup if a BO3 is abandoned or the automatic popup does not appear.</p>
    </section>
  );
}

function SyncModeControl({ settings, onSave, compact = false }: { settings: UserSettings; onSave: (patch: Partial<UserSettings>) => Promise<void>; compact?: boolean }) {
  const publicEnabled = publicCommunitySyncEnabled(settings);
  const modeCopy = settings.syncMode === "private-hubs-only"
    ? "Only selected private hubs receive saved matches."
    : settings.syncMode === "community-only"
      ? "Only public community stats receive saved matches."
    : settings.syncMode === "local-only"
      ? "Matches stay on this device until you choose otherwise."
      : publicEnabled
        ? "Public community stats and selected private hubs receive saved matches."
        : "Custom sync is private unless community sharing is enabled.";
  return (
    <div className={compact ? "sync-mode-control compact" : "sync-mode-control"}>
      <label>
        Share destination
        <select
          value={settings.syncMode}
          onChange={(event) => void onSave(syncModePatch(event.target.value as UserSettings["syncMode"]))}
        >
          <option value="community-and-hubs">Community + private hubs</option>
          <option value="community-only">Community only</option>
          <option value="private-hubs-only">Private hubs only</option>
          <option value="local-only">Local only</option>
        </select>
      </label>
      <p className="muted"><Shield size={14} /> {modeCopy}</p>
    </div>
  );
}

function DashboardView({
  view,
  matches,
  replays,
  deletedMatches,
  deletedReplays,
  decks,
  battlefields,
  communityMatches,
  hubMatches,
  communityStatus,
  importSummary,
  settings,
  browsers,
  overlayInfo,
  diagnosticsPath,
  diagnosticsSummary,
  diagnosticsBundlePath,
  updateStatus,
  screenshotStatus,
  onSaveSettings,
  onDecksChanged,
  onSaveHubResult,
  onSyncPrivateHubs,
  onSyncMatchesToHubs,
  onDeleteHubMatch,
  onRefreshCommunity,
  onImportLegacy,
  onTakeScreenshot,
  onChooseScreenshotDirectory,
  onOpenScreenshotDirectory,
  onRefreshDiagnostics,
  onCreateDiagnosticsBundle,
  onCheckUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onRestoreDeletedMatch,
  onPurgeDeletedMatch,
  onRestoreDeletedReplay,
  onPurgeDeletedReplay,
  onMatchesChanged,
  replayFocusId,
  onReplayFocusConsumed,
  onOpenReplayForMatch,
  onReplaysChanged,
  onDeleteReplay,
  onReview,
  onDelete
}: {
  view: ActiveView;
  matches: MatchDraft[];
  replays: ReplayRecord[];
  deletedMatches: MatchDraft[];
  deletedReplays: ReplayRecord[];
  decks: SavedDeck[];
  battlefields: BattlefieldOption[];
  communityMatches: CommunityMatch[];
  hubMatches: Record<string, CommunityMatch[]>;
  communityStatus: string;
  importSummary: ImportSummary | null;
  settings: UserSettings;
  browsers: BrowserInfo[];
  overlayInfo: OverlayInfo | null;
  diagnosticsPath: string;
  diagnosticsSummary: CaptureDiagnosticsSummary | null;
  diagnosticsBundlePath: string;
  updateStatus: UpdateStatus;
  screenshotStatus: string;
  onSaveSettings: (patch: Partial<UserSettings>) => Promise<void>;
  onDecksChanged: () => Promise<void>;
  onSaveHubResult: (result: HubActionResult) => Promise<void>;
  onSyncPrivateHubs: () => Promise<PrivateHubSyncResult>;
  onSyncMatchesToHubs: (matchIds: string[], hubIds: string[]) => Promise<PrivateHubSyncResult>;
  onDeleteHubMatch: (hubId: string, matchId: string) => Promise<void>;
  onRefreshCommunity: () => Promise<void>;
  onImportLegacy: () => Promise<void>;
  onTakeScreenshot: () => Promise<void>;
  onChooseScreenshotDirectory: () => Promise<void>;
  onOpenScreenshotDirectory: () => Promise<void>;
  onRefreshDiagnostics: () => Promise<void>;
  onCreateDiagnosticsBundle: () => Promise<void>;
  onCheckUpdates: () => Promise<void>;
  onDownloadUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onRestoreDeletedMatch: (id: string) => Promise<void>;
  onPurgeDeletedMatch: (id: string) => Promise<void>;
  onRestoreDeletedReplay: (id: string) => Promise<void>;
  onPurgeDeletedReplay: (id: string) => Promise<void>;
  onMatchesChanged: () => Promise<void>;
  replayFocusId: string;
  onReplayFocusConsumed: () => void;
  onOpenReplayForMatch: (matchId: string) => void;
  onReplaysChanged: (focusReplayId?: string) => Promise<void>;
  onDeleteReplay: (id: string) => Promise<void>;
  onReview: (draft: MatchDraft) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  if (view === "scorepad") {
    return <ScorepadView settings={settings} decks={decks} battlefields={battlefields} onSaveSettings={onSaveSettings} onMatchesChanged={onMatchesChanged} onReview={onReview} />;
  }
  if (view === "matches") {
    return <MatchesView matches={matches} replays={replays} onReview={onReview} onDelete={onDelete} onOpenReplay={onOpenReplayForMatch} />;
  }
  if (view === "stats") {
    return <StatsView matches={matches} />;
  }
  if (view === "spotlight") {
    return <SpotlightView />;
  }
  if (view === "stream") {
    return <StreamView overlayInfo={overlayInfo} matches={matches} decks={decks} settings={settings} onSaveSettings={onSaveSettings} />;
  }
  if (view === "decks") {
    return <DecksView decks={decks} matches={matches} settings={settings} onDecksChanged={onDecksChanged} />;
  }
  if (view === "replays") {
    return (
      <ReplayView
        replays={replays}
        matches={matches}
        settings={settings}
        focusReplayId={replayFocusId}
        onFocusConsumed={onReplayFocusConsumed}
        onReplaysChanged={onReplaysChanged}
        onDeleteReplay={onDeleteReplay}
      />
    );
  }
  if (view === "settings") {
    return (
      <SettingsView
        settings={settings}
        browsers={browsers}
        diagnosticsPath={diagnosticsPath}
        diagnosticsSummary={diagnosticsSummary}
        diagnosticsBundlePath={diagnosticsBundlePath}
        updateStatus={updateStatus}
        screenshotStatus={screenshotStatus}
        deletedMatches={deletedMatches}
        deletedReplays={deletedReplays}
        onSave={onSaveSettings}
        importSummary={importSummary}
        onImportLegacy={onImportLegacy}
        onTakeScreenshot={onTakeScreenshot}
        onChooseScreenshotDirectory={onChooseScreenshotDirectory}
        onOpenScreenshotDirectory={onOpenScreenshotDirectory}
        onRefreshDiagnostics={onRefreshDiagnostics}
        onCreateDiagnosticsBundle={onCreateDiagnosticsBundle}
        onCheckUpdates={onCheckUpdates}
        onDownloadUpdate={onDownloadUpdate}
        onInstallUpdate={onInstallUpdate}
        onRestoreDeletedMatch={onRestoreDeletedMatch}
        onPurgeDeletedMatch={onPurgeDeletedMatch}
        onRestoreDeletedReplay={onRestoreDeletedReplay}
        onPurgeDeletedReplay={onPurgeDeletedReplay}
      />
    );
  }
  if (view === "hubs") {
    return <HubsView settings={settings} matches={matches} hubMatches={hubMatches} onSave={onSaveSettings} onHubResult={onSaveHubResult} onSyncPrivateHubs={onSyncPrivateHubs} onSyncMatchesToHubs={onSyncMatchesToHubs} onDeleteHubMatch={onDeleteHubMatch} onRefresh={onRefreshCommunity} />;
  }
  return <CommunityView matches={matches} communityMatches={communityMatches} hubMatches={hubMatches} settings={settings} status={communityStatus} onRefresh={onRefreshCommunity} />;
}

function SpotlightView() {
  const [selectedId, setSelectedId] = useState("");
  const selectedSpotlight = COMMUNITY_SPOTLIGHTS.find((item) => item.id === selectedId) ?? null;
  const spotlight = selectedSpotlight ?? RIFTLAB_SPOTLIGHT;
  const [assetMap, setAssetMap] = useState<Record<string, Partial<Record<SpotlightAssetKey, string>>>>({});
  const assets = assetMap[spotlight.id] ?? {};
  const featuredLinks = spotlight.links.filter((link) => link.featured);
  const socialLinks = spotlight.links.filter((link) => !link.featured);
  const mediaRoutes = spotlight.routes ?? [
    { key: "youtube" as const, title: "Guides and VODs", subtitle: "Watch match reviews and competitive breakdowns.", linkId: "youtube" },
    { key: "twitch" as const, title: "Live coverage", subtitle: "Catch events and community streams as they happen.", linkId: "twitch" },
    { key: "tiktok" as const, title: "Short-form clips", subtitle: "Quick highlights and Riftbound moments.", linkId: "tiktok" }
  ];
  const mediaTiles = mediaRoutes.map((route) => ({
    ...route,
    link: spotlight.links.find((item) => item.id === route.linkId)
  }));
  const PrimaryIcon = spotlight.primaryCta.icon;
  const allLinksLink = spotlight.links.find((link) => ["linktree", "website", "metafy"].includes(link.id)) ?? spotlight.primaryCta;

  useEffect(() => {
    let mounted = true;
    void Promise.all(
      COMMUNITY_SPOTLIGHTS.flatMap((item) =>
        (Object.entries(item.assets) as Array<[SpotlightAssetKey, string]>).map(async ([key, path]) => ({
          id: item.id,
          key,
          url: await window.riftlite.getAssetUrl(path)
        }))
      )
    ).then((entries) => {
      if (mounted) {
        const next: Record<string, Partial<Record<SpotlightAssetKey, string>>> = {};
        for (const entry of entries) {
          next[entry.id] = {
            ...next[entry.id],
            [entry.key]: entry.url
          };
        }
        setAssetMap(next);
      }
    }).catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  function trackSpotlight(linkId: string, source: string, spotlightId = spotlight.id) {
    void window.riftlite.trackSpotlightClick({
      spotlightId,
      linkId,
      appVersion: APP_VERSION_META,
      source
    });
  }

  function openLink(link: SpotlightLink, source = "link-card") {
    trackSpotlight(link.id, source);
    void window.riftlite.openExternalResource(link.url);
  }

  function openPlainLink(url: string) {
    void window.riftlite.openExternalResource(url);
  }

  function selectSpotlight(item: CommunitySpotlight) {
    trackSpotlight("profile-open", "overview-card", item.id);
    setSelectedId(item.id);
  }

  if (!selectedSpotlight) {
    return (
      <section className="spotlight-page">
        <section className="spotlight-overview-hero">
          <div>
            <span>Community spotlight</span>
            <h2>Featured Riftbound creators</h2>
            <p>Teams, tournament organisers, content creators, and community projects worth putting in front of players.</p>
          </div>
        </section>
        <section className="spotlight-overview-grid">
          {COMMUNITY_SPOTLIGHTS.map((item) => (
            <button className="spotlight-overview-card" type="button" key={item.id} onClick={() => selectSpotlight(item)}>
              {assetMap[item.id]?.banner ? <img className="spotlight-overview-banner" src={assetMap[item.id]?.banner} alt="" /> : null}
              <div className="spotlight-overview-content">
                <span className="spotlight-overview-logo">
                  {assetMap[item.id]?.logo ? <img src={assetMap[item.id]?.logo} alt={`${item.name} logo`} /> : <Compass size={32} />}
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <em>{item.location} | {item.highlights.slice(0, 2).map((highlight) => highlight.title).join(", ")}</em>
                </span>
                <ChevronRight size={18} />
              </div>
            </button>
          ))}
        </section>
        <section className="rail-card spotlight-contact-card">
          <strong>Want to be featured?</strong>
          <span>If you want you or your event to be featured, please reach out to BMUCasts@gmail.com</span>
          <button className="secondary" type="button" onClick={() => openPlainLink("mailto:BMUCasts@gmail.com")}>
            <ExternalLink size={14} /> Contact BMU
          </button>
        </section>
      </section>
    );
  }

  return (
    <section className="spotlight-page">
      <section className="spotlight-hero">
        {assets.banner ? <img className="spotlight-banner" src={assets.banner} alt="" /> : null}
        <div className="spotlight-hero-content">
          <div className="spotlight-logo-frame">
            {assets.logo ? <img src={assets.logo} alt={`${spotlight.name} logo`} /> : <Compass size={44} />}
          </div>
          <div className="spotlight-copy">
            <span>{spotlight.kicker}</span>
            <h2>{spotlight.name}</h2>
            <p>{spotlight.description}</p>
            <div className="spotlight-tags">
              <strong>{spotlight.location}</strong>
              {(spotlight.tags ?? ["Tournaments", "Guides", "Match VODs"]).map((tag) => <strong key={tag}>{tag}</strong>)}
            </div>
          </div>
          <div className="spotlight-actions">
            <button className="secondary" onClick={() => setSelectedId("")}>
              <ChevronLeft size={16} /> Spotlights
            </button>
            <button className="primary" onClick={() => openLink(spotlight.primaryCta, "primary-cta")}>
              <PrimaryIcon size={16} /> {spotlight.primaryCta.label}
            </button>
            <button className="secondary" onClick={() => openLink(allLinksLink, "all-links")}>
              <ExternalLink size={16} /> All links
            </button>
          </div>
        </div>
      </section>

      <div className="spotlight-grid">
        <section className="rail-card spotlight-panel">
          <div className="panel-header compact-header">
            <div>
              <h2>Featured channels</h2>
              <span>Follow {spotlight.name} where you prefer to watch and chat.</span>
            </div>
          </div>
          <div className="spotlight-link-grid">
            {[...featuredLinks, ...socialLinks].map((link) => {
              const LinkIcon = link.icon;
              return (
                <button className="spotlight-link-card" type="button" key={link.id} onClick={() => openLink(link, "channel-card")}>
                  <LinkIcon size={18} />
                  <span>
                    <strong>{link.label}</strong>
                    <em>{link.description}</em>
                  </span>
                  <ExternalLink size={14} />
                </button>
              );
            })}
          </div>
        </section>

        <section className="rail-card spotlight-panel">
          <div className="panel-header compact-header">
            <div>
              <h2>Why follow</h2>
              <span>Competitive content without sending users into a noisy feed.</span>
            </div>
          </div>
          <div className="spotlight-highlight-grid">
            {spotlight.highlights.map((highlight) => (
              <div className="spotlight-highlight-card" key={highlight.title}>
                <strong>{highlight.title}</strong>
                <p>{highlight.text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rail-card spotlight-media-panel">
        <div className="panel-header compact-header">
          <div>
            <h2>Content routes</h2>
            <span>Quick access to {spotlight.name}'s main content lanes.</span>
          </div>
        </div>
        <div className="spotlight-media-grid">
          {mediaTiles.map((tile) => (
            <button
              className="spotlight-media-card"
              type="button"
              key={tile.key}
              onClick={() => tile.link ? openLink(tile.link, `media-${tile.key}`) : undefined}
            >
              {assets[tile.key] ? <img src={assets[tile.key]} alt="" loading="lazy" /> : <span />}
              <div>
                <strong>{tile.title}</strong>
                <p>{tile.subtitle}</p>
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="rail-card spotlight-contact-card">
        <strong>Want to be featured?</strong>
        <span>If you want you or your event to be featured, please reach out to BMUCasts@gmail.com</span>
        <button className="secondary" type="button" onClick={() => openPlainLink("mailto:BMUCasts@gmail.com")}>
          <ExternalLink size={14} /> Contact BMU
        </button>
      </section>
    </section>
  );
}

function CaptureLabView({ summary, bundlePath, settings, embedded = false, onSave, onRefresh, onBundle, onOpenFolder }: {
  summary: CaptureDiagnosticsSummary | null;
  bundlePath: string;
  settings: UserSettings;
  embedded?: boolean;
  onSave: (patch: Partial<UserSettings>) => Promise<void>;
  onRefresh: () => Promise<void>;
  onBundle: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
}) {
  const tcga = summary?.latest.find((item) => item.platform === "tcga");
  const atlas = summary?.latest.find((item) => item.platform === "atlas");
  return (
    <section className={embedded ? "capture-lab capture-lab-embedded" : "dashboard-page capture-lab"}>
      <div className="panel-header">
        <div>
          <h2>Capture Lab</h2>
          <span>{summary?.totalEvents ?? 0} events retained{summary?.lastEventAt ? ` - last ${new Date(summary.lastEventAt).toLocaleTimeString()}` : ""}</span>
        </div>
        <div className="row-actions">
          <label className="inline-toggle" title="Record extra page state, selector counts, URL changes, and browser errors while testing">
            <span>Debug capture</span>
            <input
              type="checkbox"
              checked={settings.debugMode}
              onChange={(event) => void onSave({ debugMode: event.target.checked })}
            />
          </label>
          <button className="secondary" onClick={() => void onRefresh()}>Refresh</button>
          <button className="secondary" onClick={() => void onOpenFolder()}><FolderOpen size={16} /> Folder</button>
          <button className="primary" onClick={() => void onBundle()}>Create bundle</button>
        </div>
      </div>

      <section className="metric-grid">
        <Metric label="TCGA events" value={String(summary?.byPlatform.tcga ?? 0)} />
        <Metric label="Atlas events" value={String(summary?.byPlatform.atlas ?? 0)} />
        <Metric label="Match starts" value={String(summary?.byKind["match-start"] ?? 0)} />
        <Metric label="Debug events" value={String(summary?.byKind.debug ?? 0)} />
      </section>

      {settings.debugMode ? (
        <section className="rail-card">
          <h2>Debug capture is on</h2>
          <p className="muted">Leave this enabled while testing TCGA or Atlas. After a missed match, use Create bundle and send the generated JSON file.</p>
        </section>
      ) : null}

      <section className="two-column capture-evidence-grid">
        <CaptureEvidenceCard title="TCGA" evidence={tcga} />
        <CaptureEvidenceCard title="Atlas" evidence={atlas} />
      </section>

      <section className="rail-card">
        <h2>Event mix</h2>
        <div className="event-kind-grid">
          {Object.entries(summary?.byKind ?? {}).map(([kind, count]) => (
            <div className="event-kind" key={kind}><span>{kind}</span><strong>{count}</strong></div>
          ))}
          {!Object.keys(summary?.byKind ?? {}).length ? <p className="muted">No capture events yet.</p> : null}
        </div>
      </section>

      {bundlePath ? (
        <section className="rail-card">
          <h2>Latest bundle</h2>
          <input readOnly value={bundlePath} />
        </section>
      ) : null}
    </section>
  );
}

function CaptureEvidenceCard({ title, evidence }: { title: string; evidence?: CaptureDiagnosticsSummary["latest"][number] }) {
  return (
    <section className="rail-card evidence-card">
      <div className="evidence-title">
        <h2>{title}</h2>
        <span className={`sync-pill ${evidence?.active ? "pending" : "disabled"}`}>{evidence?.active ? "active" : "idle"}</span>
      </div>
      {evidence ? (
        <div className="evidence-list">
          <EvidenceRow label="Last seen" value={new Date(evidence.lastEventAt).toLocaleTimeString()} />
          <EvidenceRow label="Player" value={evidence.player || "pending"} />
          <EvidenceRow label="Opponent" value={evidence.opponent || "pending"} />
          <EvidenceRow label="Score" value={evidence.score || "pending"} />
          <EvidenceRow label="Format" value={evidence.format || "auto"} />
          <EvidenceRow label="Cards" value={`${evidence.cardCount}${evidence.hasCards ? " seen" : ""}`} />
          <EvidenceRow label="Log rows" value={String(evidence.logRows)} />
          <EvidenceRow label="Room" value={evidence.roomCode || "pending"} />
          <EvidenceRow label="End text" value={evidence.endText || "pending"} />
          <EvidenceRow label="Keys" value={evidence.payloadKeys.join(", ") || "none"} wide />
        </div>
      ) : (
        <p className="muted">No evidence for this platform yet.</p>
      )}
    </section>
  );
}

function EvidenceRow({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? "evidence-row wide" : "evidence-row"}><span>{label}</span><strong>{value}</strong></div>;
}

function ScorepadView({
  settings,
  decks,
  battlefields,
  onSaveSettings,
  onMatchesChanged,
  onReview
}: {
  settings: UserSettings;
  decks: SavedDeck[];
  battlefields: BattlefieldOption[];
  onSaveSettings: (patch: Partial<UserSettings>) => Promise<void>;
  onMatchesChanged: () => Promise<void>;
  onReview: (draft: MatchDraft) => void;
}) {
  const [mode, setMode] = useState<"live" | "quick">("live");
  const [format, setFormat] = useState<MatchDraft["format"]>("Bo1");
  const [opponentName, setOpponentName] = useState("");
  const [myChampion, setMyChampion] = useState("");
  const [opponentChampion, setOpponentChampion] = useState("");
  const [eventName, setEventName] = useState("");
  const [roundName, setRoundName] = useState("");
  const [notes, setNotes] = useState("");
  const [deckId, setDeckId] = useState(settings.activeDeckId);
  const [phoneStatus, setPhoneStatus] = useState("");
  const [phoneQrUrl, setPhoneQrUrl] = useState("");
  const [showPhoneQr, setShowPhoneQr] = useState(true);
  const [games, setGames] = useState<MatchGame[]>([emptyScorepadGame(1)]);
  const selectedDeck = decks.find((deck) => deck.id === deckId) ?? null;
  const visibleGames = format === "Bo3" ? ensureScorepadBo3Games(games) : [games[0] ?? emptyScorepadGame(1)];
  const summary = reviewMatchSummary(visibleGames, visibleGames[0]?.result ?? "Incomplete");
  const activeGame = visibleGames[visibleGames.length - 1] ?? emptyScorepadGame(1);

  function patchGame(index: number, patch: Partial<MatchGame>) {
    setGames((current) => {
      const next = format === "Bo3" ? ensureScorepadBo3Games(current) : [current[0] ?? emptyScorepadGame(1)];
      next[index] = normalizeReviewGame({ ...next[index], ...patch, gameNumber: index + 1 });
      return next;
    });
  }

  function changeScore(index: number, side: "me" | "opp", delta: number) {
    const game = visibleGames[index] ?? emptyScorepadGame(index + 1);
    const current = side === "me" ? game.myPoints ?? 0 : game.oppPoints ?? 0;
    const nextScore = Math.max(0, current + delta);
    patchGame(index, side === "me" ? { myPoints: nextScore } : { oppPoints: nextScore });
  }

  function patchScore(index: number, side: "me" | "opp", value: string) {
    const parsed = parseReviewScore(value);
    patchGame(index, side === "me" ? { myPoints: parsed } : { oppPoints: parsed });
  }

  function addGame() {
    if (format !== "Bo3") {
      setFormat("Bo3");
      setGames(ensureScorepadBo3Games(games).slice(0, 2));
      return;
    }
    setGames((current) => {
      const next = ensureScorepadBo3Games(current);
      const used = next.filter((game) => hasScorepadGameData(game));
      const targetLength = Math.min(3, Math.max(used.length + 1, 2));
      return next.slice(0, targetLength);
    });
  }

  function resetScorepad() {
    setFormat("Bo1");
    setOpponentName("");
    setMyChampion("");
    setOpponentChampion("");
    setEventName("");
    setRoundName("");
    setNotes("");
    setDeckId(settings.activeDeckId);
    setGames([emptyScorepadGame(1)]);
  }

  function openReview() {
    const selectedGames = format === "Bo3"
      ? visibleGames.filter((game, index) => index < 2 || hasScorepadGameData(game)).map((game, index) => normalizeReviewGame({ ...game, gameNumber: index + 1 }))
      : [normalizeReviewGame({ ...visibleGames[0], gameNumber: 1 })];
    const matchSummary = reviewMatchSummary(selectedGames, selectedGames[0]?.result ?? "Incomplete");
    const capturedAt = new Date().toISOString();
    const sourceNotes = [eventName ? `Event: ${eventName}` : "", roundName ? `Round: ${roundName}` : "", notes].filter(Boolean).join("\n");
    const deckSnapshotJson = selectedDeck?.snapshotJson ?? "";
    const draft: MatchDraft = {
      id: `scorepad-${newScorepadId()}`,
      platform: "atlas",
      source: "scorepad",
      status: "pending-review",
      capturedAt,
      updatedAt: capturedAt,
      result: matchSummary.result,
      format: selectedGames.length > 1 ? "Bo3" : "Bo1",
      score: matchSummary.score,
      myName: settings.username || "You",
      opponentName: opponentName.trim(),
      myChampion: normalizeLegendName(myChampion || selectedDeck?.legend || ""),
      opponentChampion: normalizeLegendName(opponentChampion),
      myBattlefield: selectedGames[0]?.myBattlefield ?? "",
      opponentBattlefield: selectedGames[0]?.oppBattlefield ?? "",
      deckName: selectedDeck?.title ?? "",
      deckSourceId: selectedDeck?.sourceKey || selectedDeck?.id || "",
      deckSourceUrl: selectedDeck?.sourceUrl ?? "",
      deckSourceKey: selectedDeck?.sourceKey ?? "",
      deckSnapshotJson,
      flags: "scorepad",
      notes: sourceNotes,
      games: selectedGames,
      rawEvidence: [],
      sync: {
        community: "disabled",
        hubs: {}
      }
    };
    onReview(draft);
  }

  async function ensurePhoneLink() {
    const currentId = settings.scorepadDeviceId.trim();
    const currentSecret = settings.scorepadDeviceSecret.trim();
    if (currentId && currentSecret) {
      return { deviceId: currentId, secret: currentSecret };
    }
    const deviceId = `rl-${newScorepadId().replace(/-/g, "").slice(0, 18)}`;
    const secret = newScorepadId().replace(/-/g, "");
    await onSaveSettings({
      scorepadDeviceId: deviceId,
      scorepadDeviceSecret: secret,
      scorepadLinkedAt: new Date().toISOString()
    });
    return { deviceId, secret };
  }

  async function copyPhoneLink() {
    const link = await ensurePhoneLink();
    const url = scorepadPhoneUrl(link.deviceId, link.secret);
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setPhoneStatus("Phone Scorepad link copied.");
  }

  async function createPhoneLink() {
    await ensurePhoneLink();
    setShowPhoneQr(true);
    setPhoneStatus("Phone link ready. Scan the QR code with your phone camera.");
  }

  async function resetPhoneLink() {
    await onSaveSettings({
      scorepadDeviceId: "",
      scorepadDeviceSecret: "",
      scorepadLinkedAt: ""
    });
    setPhoneStatus("Phone link reset. Create a new link when you need it.");
  }

  async function pullPhoneLogs() {
    const link = await ensurePhoneLink();
    setPhoneStatus("Checking phone Scorepad inbox...");
    const response = await fetch("https://www.riftlite.com/api/scorepad/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(link)
    });
    if (!response.ok) {
      setPhoneStatus("Phone inbox was not available yet. Website API may not be deployed.");
      return;
    }
    const payload = await response.json() as { entries?: Array<{ id: string; match: unknown }> };
    const entries = payload.entries ?? [];
    if (!entries.length) {
      setPhoneStatus("No phone Scorepad logs waiting.");
      return;
    }
    const importedIds: string[] = [];
    for (const entry of entries) {
      const draft = scorepadInboxEntryToDraft(entry, settings, decks);
      if (!draft) {
        continue;
      }
      await window.riftlite.saveMatchDraft(draft);
      importedIds.push(entry.id);
    }
    if (importedIds.length) {
      await fetch("https://www.riftlite.com/api/scorepad/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...link, ids: importedIds })
      }).catch(() => undefined);
      await onMatchesChanged();
    }
    setPhoneStatus(importedIds.length ? `Imported ${importedIds.length} phone Scorepad log${importedIds.length === 1 ? "" : "s"}.` : "No valid phone logs were ready to import.");
  }

  const phoneLinked = Boolean(settings.scorepadDeviceId && settings.scorepadDeviceSecret);
  const phoneUrl = phoneLinked ? scorepadPhoneUrl(settings.scorepadDeviceId, settings.scorepadDeviceSecret) : "";

  useEffect(() => {
    if (!phoneUrl || !showPhoneQr) {
      setPhoneQrUrl("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(phoneUrl, {
      width: 220,
      margin: 1,
      color: {
        dark: "#071120",
        light: "#f2fbff"
      }
    })
      .then((url) => {
        if (!cancelled) {
          setPhoneQrUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPhoneQrUrl("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [phoneUrl, showPhoneQr]);

  return (
    <section className="dashboard-page scorepad-page">
      <section className="scorepad-hero">
        <div>
          <span className="eyebrow">Local-only match logging</span>
          <h2>Scorepad</h2>
          <p>Use this during table games, Nexus Nights, and skirmishes. Scorepad matches save into your personal history, stay out of public community stats, and can be filtered later.</p>
        </div>
        <div className="scorepad-mode-toggle">
          <button className="segmented" data-active={mode === "live"} onClick={() => setMode("live")}><Calculator size={16} /> Live score</button>
          <button className="segmented" data-active={mode === "quick"} onClick={() => setMode("quick")}><ClipboardList size={16} /> Quick log</button>
        </div>
      </section>

      <section className="scorepad-layout">
        <div className="rail-card scorepad-card">
          <div className="filters-title">
            <h2>{mode === "live" ? "Live score" : "Quick log"}</h2>
            <span>{format === "Bo3" ? "Best of 3" : "Single game"}</span>
          </div>
          <div className="scorepad-form-grid">
            <label>Format<select value={format} onChange={(event) => setFormat(event.target.value as MatchDraft["format"])}><option>Bo1</option><option>Bo3</option></select></label>
            <label>Opponent<input value={opponentName} onChange={(event) => setOpponentName(event.target.value)} placeholder="Opponent name" /></label>
            <LegendInput label="My legend" value={myChampion || selectedDeck?.legend || ""} onChange={setMyChampion} placeholder={selectedDeck?.legend || "Search legends"} />
            <LegendInput label="Opponent legend" value={opponentChampion} onChange={setOpponentChampion} placeholder="Search legends" />
            <label>Deck<select value={deckId} onChange={(event) => setDeckId(event.target.value)}>
              <option value="">No deck</option>
              {decks.map((deck) => <option value={deck.id} key={deck.id}>{deck.title}</option>)}
            </select></label>
            <label>Event<input value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder="Nexus Night, Skirmish..." /></label>
            <label>Round<input value={roundName} onChange={(event) => setRoundName(event.target.value)} placeholder="Round 3, finals..." /></label>
          </div>

          <div className={format === "Bo3" ? "scorepad-games bo3" : "scorepad-games"}>
            {visibleGames.map((game, index) => (
              <div className="scorepad-game-card" key={`scorepad-game-${index + 1}`}>
                <div className="review-game-title">
                  <strong>Game {index + 1}</strong>
                  <span>{scoreTextFromGame(game) || "0-0"}</span>
                </div>
                <label>Result<select value={game.result} onChange={(event) => patchGame(index, { result: event.target.value as MatchGame["result"] })}><option>Incomplete</option><option>Win</option><option>Loss</option><option>Draw</option></select></label>
                <div className="scorepad-score-row">
                  <button className="secondary" onClick={() => changeScore(index, "me", -1)}>-</button>
                  <label>Me<input type="number" min="0" value={formatReviewScore(game.myPoints)} onChange={(event) => patchScore(index, "me", event.target.value)} /></label>
                  <button className="secondary" onClick={() => changeScore(index, "me", 1)}><Plus size={14} /></button>
                  <button className="secondary" onClick={() => changeScore(index, "opp", -1)}>-</button>
                  <label>Opponent<input type="number" min="0" value={formatReviewScore(game.oppPoints)} onChange={(event) => patchScore(index, "opp", event.target.value)} /></label>
                  <button className="secondary" onClick={() => changeScore(index, "opp", 1)}><Plus size={14} /></button>
                </div>
                <label>Seat<select value={game.wentFirst ?? ""} onChange={(event) => patchGame(index, { wentFirst: normalizeWentFirst(event.target.value) })}><option value="">Unknown</option><option value="1st">Went 1st</option><option value="2nd">Went 2nd</option><option value="undecided">Undecided / no seat</option></select></label>
                <BattlefieldInput strict label="My battlefield" value={game.myBattlefield ?? ""} options={battlefields} onChange={(value) => patchGame(index, { myBattlefield: value })} />
                <BattlefieldInput strict label="Opponent battlefield" value={game.oppBattlefield ?? ""} options={battlefields} onChange={(value) => patchGame(index, { oppBattlefield: value })} />
              </div>
            ))}
          </div>

          <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Key plays, judge call, opponent conceded..." /></label>
          <div className="scorepad-actions">
            {format === "Bo3" && visibleGames.length < 3 ? <button className="secondary" onClick={addGame}><Plus size={16} /> Add game</button> : null}
            <button className="secondary" onClick={resetScorepad}><RotateCcw size={16} /> Reset</button>
            <button className="primary" onClick={openReview}><Save size={16} /> Save to review</button>
          </div>
        </div>

        <aside className="scorepad-side">
          <section className="rail-card scorepad-summary-card">
            <h2>Current card</h2>
            <Metric label="Match record" value={summary.score || "Pending"} />
            <Metric label="Active game" value={scoreTextFromGame(activeGame) || "0-0"} />
            <Metric label="Source" value="Scorepad" />
            <p className="muted"><Shield size={14} /> Public community upload is disabled for Scorepad matches.</p>
          </section>
          <section className="rail-card scorepad-phone-card">
            <div className="scorepad-phone-header">
              <div>
                <Smartphone size={22} />
                <h2>Phone Scorepad</h2>
              </div>
              {phoneLinked ? (
                <button className="secondary scorepad-qr-toggle" onClick={() => setShowPhoneQr((current) => !current)}>
                  {showPhoneQr ? "Hide QR" : "Show QR"}
                </button>
              ) : null}
            </div>
            <p className="muted">Create a private phone link once. Scan it from your phone, score table games there, then import them here.</p>
            {phoneLinked ? (
              showPhoneQr ? (
                phoneQrUrl ? (
                  <div className="scorepad-qr-panel">
                    <img src={phoneQrUrl} alt="Phone Scorepad QR code" />
                    <span>Scan with your phone camera</span>
                  </div>
                ) : <p className="muted">Preparing QR code...</p>
              ) : <p className="muted">QR code hidden. Use Show QR or copy the link when you need to pair a phone.</p>
            ) : (
              <button className="primary scorepad-qr-create" onClick={() => void createPhoneLink()}><Smartphone size={16} /> Create phone QR</button>
            )}
            {phoneLinked ? <input readOnly value={phoneUrl} aria-label="Phone Scorepad link" /> : null}
            <div className="scorepad-phone-actions">
              <button className="secondary" onClick={() => void copyPhoneLink()}><Smartphone size={16} /> Copy link</button>
              <button className="secondary" onClick={() => void pullPhoneLogs()}><FolderOpen size={16} /> Import phone logs</button>
              {phoneLinked ? <button className="secondary" onClick={() => void resetPhoneLink()}>Reset link</button> : null}
            </div>
            <span className="source-badge">Pair once, sync later</span>
            {phoneStatus ? <p className="muted">{phoneStatus}</p> : null}
          </section>
        </aside>
      </section>
    </section>
  );
}

function MatchesView({
  matches,
  replays,
  onReview,
  onDelete,
  onOpenReplay
}: {
  matches: MatchDraft[];
  replays: ReplayRecord[];
  onReview: (draft: MatchDraft) => void;
  onDelete: (id: string) => Promise<void>;
  onOpenReplay: (matchId: string) => void;
}) {
  const [filters, setFilters] = useState<MatchHistoryFilters>(DEFAULT_MATCH_HISTORY_FILTERS);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const analyticsMatches = useMemo(() => validAnalytics(matches.map(localToAnalytics)), [matches]);
  const filteredMatches = useMemo(() => filterLocalMatches(matches, filters), [matches, filters]);
  const legendOptions = useMemo(() => matrixLegendOptions(analyticsMatches), [analyticsMatches]);
  const myLegendOptions = useMemo(() => sideLegendOptions(analyticsMatches, "me"), [analyticsMatches]);
  const opponentLegendOptions = useMemo(() => sideLegendOptions(analyticsMatches, "opponent"), [analyticsMatches]);
  const selectedMatch = selectedMatchId ? filteredMatches.find((match) => match.id === selectedMatchId) : undefined;
  const selectedAnalyticsMatch = useMemo(() => selectedMatch ? localToAnalytics(selectedMatch) : null, [selectedMatch]);
  const replayByMatch = useMemo(() => new Map(replays.map((replay) => [replay.matchId, replay])), [replays]);
  const stats = useMemo(() => localMatchStats(filteredMatches), [filteredMatches]);
  const filtersActive = Object.entries(filters).some(([key, value]) => value && !(key === "range" && value === "all"));

  function setFilter(key: keyof MatchHistoryFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedMatchId("");
  }

  useEffect(() => {
    if (!selectedMatchId) {
      return;
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedMatchId("");
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedMatchId]);

  return (
    <section className="dashboard-page matches-page">
      <div className="panel-header">
        <div>
          <h2>Local match history</h2>
          <span>{filteredMatches.length} of {matches.length} match{matches.length === 1 ? "" : "es"} shown</span>
        </div>
        {filtersActive ? <button className="secondary" onClick={() => setFilters(DEFAULT_MATCH_HISTORY_FILTERS)}>Clear filters</button> : null}
      </div>
      <section className="metric-grid">
        <Metric label="Shown" value={String(filteredMatches.length)} />
        <Metric label="Win rate" value={stats.winRate} />
        <Metric label="Record" value={stats.record} />
        <Metric label="Streak" value={stats.streak} />
        <Metric label="Most played" value={stats.mostPlayed || "Pending"} />
      </section>
      <section className="rail-card local-match-filters">
        <div className="filters-title">
          <h2>Filters</h2>
          <span>{filtersActive ? "Filtered view" : "Showing all local matches"}</span>
        </div>
        <div className="local-filter-grid">
          <label>Search<input value={filters.search} onChange={(event) => setFilter("search", event.target.value)} placeholder="Opponent, deck, flag..." /></label>
          <label>Legend<select value={filters.legend} onChange={(event) => setFilter("legend", event.target.value)}>
            <option value="">All legends</option>
            {legendOptions.map((legend) => <option value={legend} key={legend}>{legend}</option>)}
          </select></label>
          <label>My legend<select value={filters.myLegend} onChange={(event) => setFilter("myLegend", event.target.value)}>
            <option value="">Any my legend</option>
            {myLegendOptions.map((legend) => <option value={legend} key={legend}>{legend}</option>)}
          </select></label>
          <label>Opponent legend<select value={filters.opponentLegend} onChange={(event) => setFilter("opponentLegend", event.target.value)}>
            <option value="">Any opponent legend</option>
            {opponentLegendOptions.map((legend) => <option value={legend} key={legend}>{legend}</option>)}
          </select></label>
          <label>Result<select value={filters.result} onChange={(event) => setFilter("result", event.target.value)}>
            <option value="">All results</option>
            <option value="Win">Wins</option>
            <option value="Loss">Losses</option>
            <option value="Draw">Draws</option>
            <option value="Incomplete">Incomplete</option>
          </select></label>
          <label>Platform<select value={filters.platform} onChange={(event) => setFilter("platform", event.target.value)}>
            <option value="">All platforms</option>
            <option value="tcga">TCGA</option>
            <option value="atlas">Atlas</option>
          </select></label>
          <label>Format<select value={filters.format} onChange={(event) => setFilter("format", event.target.value)}>
            <option value="">All formats</option>
            <option value="Bo1">Bo1</option>
            <option value="Bo3">Bo3</option>
            <option value="Auto">Auto</option>
          </select></label>
          <label>Source<select value={filters.source} onChange={(event) => setFilter("source", event.target.value)}>
            <option value="">All sources</option>
            <option value="capture">Auto captured</option>
            <option value="scorepad">Scorepad</option>
          </select></label>
          <label>Seat<select value={filters.seat} onChange={(event) => setFilter("seat", event.target.value)}>
            <option value="">Any seat</option>
            <option value="1st">Went 1st</option>
            <option value="2nd">Went 2nd</option>
            <option value="undecided">Undecided / no seat</option>
            <option value="unknown">Unknown</option>
          </select></label>
          <label>Date<select value={filters.range} onChange={(event) => setFilter("range", event.target.value)}>
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select></label>
          <label>Sync<select value={filters.sync} onChange={(event) => setFilter("sync", event.target.value)}>
            <option value="">Any sync</option>
            <option value="pending">Pending</option>
            <option value="synced">Synced</option>
            <option value="failed">Failed</option>
            <option value="disabled">Disabled</option>
          </select></label>
        </div>
      </section>
      <div className="match-table local-match-table">
        {filteredMatches.map((match) => {
          const myLegend = normalizeLegendName(match.myChampion);
          const opponentLegend = normalizeLegendName(match.opponentChampion);
          return (
          <div
            className="match-row interactive-row"
            data-active={selectedMatchId === match.id}
            key={match.id}
            tabIndex={0}
            role="button"
            onClick={() => setSelectedMatchId((current) => current === match.id ? "" : match.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedMatchId((current) => current === match.id ? "" : match.id);
              }
            }}
          >
            <div className="match-result-block">
              <span className="match-result-pill" data-result={match.result}>{match.result}</span>
              <strong>{displayMatchRecord(match) || "Score pending"}</strong>
              <span>{new Date(match.capturedAt).toLocaleString()}</span>
            </div>
            <div className="match-legend-cell">
              <LegendAvatar legend={myLegend || "Unknown"} />
              <div>
                <strong>{myLegend || "Unknown"}</strong>
                <span>vs {opponentLegend || "unknown"}</span>
              </div>
            </div>
            <div>
              <strong>{match.opponentName || "Unknown opponent"}</strong>
              <span>{matchSourceLabel(match)} - {match.format}</span>
            </div>
            <div>
              <strong>{match.deckName || "Deck pending"}</strong>
              <span>{match.flags || "No flags"}</span>
            </div>
            <SyncPill match={match} />
            <div className="row-actions">
              {replayByMatch.has(match.id) ? (
                <button className="secondary" onClick={(event) => { event.stopPropagation(); onOpenReplay(match.id); }}>
                  <Images size={14} /> Replay
                </button>
              ) : null}
              <button className="secondary" onClick={(event) => { event.stopPropagation(); onReview(match); }}>Edit</button>
              <button className="secondary" onClick={(event) => { event.stopPropagation(); void onDelete(match.id); }}>Delete</button>
            </div>
          </div>
          );
        })}
        {!matches.length ? <p className="empty-state">Captured matches will appear here after review.</p> : null}
        {matches.length && !filteredMatches.length ? <p className="empty-state">No matches match those filters.</p> : null}
      </div>
      {selectedMatch ? (
        <div
          className="modal-backdrop matrix-popup-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedMatchId("");
            }
          }}
        >
          {selectedAnalyticsMatch ? (
            <LocalMatchDrilldown
              match={selectedAnalyticsMatch}
              relatedMatches={relatedOpponentLegendMatches(analyticsMatches, selectedAnalyticsMatch)}
              hasReplay={replayByMatch.has(selectedMatch.id)}
              onOpenReplay={() => onOpenReplay(selectedMatch.id)}
              onClose={() => setSelectedMatchId("")}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function LocalMatchDrilldown({
  match,
  relatedMatches,
  hasReplay = false,
  onOpenReplay,
  onClose
}: {
  match: AnalyticsMatch;
  relatedMatches: AnalyticsMatch[];
  hasReplay?: boolean;
  onOpenReplay?: () => void;
  onClose: () => void;
}) {
  const games = match.games.length || 1;
  const relatedStats = analyticsResultStats(relatedMatches);
  return (
    <section className="matrix-drilldown stats-drilldown local-match-popup">
      <header>
        <div className="drilldown-title">
          <LegendAvatar legend={match.myChampion || "Unknown"} size="large" />
          <div>
            <h3>{match.myChampion || "Unknown"} vs {match.opponentChampion || "Unknown"}</h3>
            <span>{match.myName || "Unknown player"} vs {match.opponentName || "Unknown opponent"} - {new Date(match.capturedAt).toLocaleString()}</span>
          </div>
          <LegendAvatar legend={match.opponentChampion || "Unknown"} size="large" />
        </div>
        <div className="row-actions">
          {hasReplay ? (
            <button className="secondary" onClick={onOpenReplay}>
              <Images size={16} /> View replay
            </button>
          ) : null}
          <button className="icon-button" onClick={onClose}>x</button>
        </div>
      </header>
      <div className="drilldown-grid">
        <Metric label="Result" value={`${match.result}${match.score ? ` ${match.score}` : ""}`} />
        <Metric label="Format" value={match.format} />
        <Metric label="Games" value={String(games)} />
        <Metric label={opponentLegendRecordLabel(match)} value={`${relatedStats.wins}-${relatedStats.losses}${relatedStats.draws ? `-${relatedStats.draws}` : ""}`} />
      </div>
      <MatchDetailPanel match={match} showFlags />
    </section>
  );
}

function matchDraftMatchesSeat(match: MatchDraft, filter: string): boolean {
  const seats = match.games
    .map((game) => normalizeWentFirst(game.wentFirst))
    .filter(Boolean);
  if (filter === "unknown") {
    return !seats.length;
  }
  return seats.includes(normalizeWentFirst(filter));
}

function filterLocalMatches(matches: MatchDraft[], filters: MatchHistoryFilters): MatchDraft[] {
  const search = filters.search.trim().toLowerCase();
  const selectedLegend = filters.legend ? normalizeLegendName(filters.legend) : "";
  const selectedMyLegend = filters.myLegend ? normalizeLegendName(filters.myLegend) : "";
  const selectedOpponentLegend = filters.opponentLegend ? normalizeLegendName(filters.opponentLegend) : "";
  return matches.filter((match) => {
    const myLegend = normalizeLegendName(match.myChampion);
    const opponentLegend = normalizeLegendName(match.opponentChampion);
    if (filters.result && match.result !== filters.result) return false;
    if (filters.platform && match.platform !== filters.platform) return false;
    if (filters.format && match.format !== filters.format) return false;
    if (filters.source && matchSource(match) !== filters.source) return false;
    if (filters.seat && !matchDraftMatchesSeat(match, filters.seat)) return false;
    if (filters.sync && match.sync.community !== filters.sync) return false;
    if (selectedLegend && myLegend !== selectedLegend && opponentLegend !== selectedLegend) return false;
    if (selectedMyLegend && myLegend !== selectedMyLegend) return false;
    if (selectedOpponentLegend && opponentLegend !== selectedOpponentLegend) return false;
    if (!matchInDateRange(match, filters.range)) return false;
    if (search) {
      const haystack = [
        match.result,
        matchSourceLabel(match),
        match.platform,
        match.format,
    displayMatchRecord(match),
        match.opponentName,
        myLegend,
        opponentLegend,
        match.deckName,
        match.flags,
        match.notes,
        match.myBattlefield,
        match.opponentBattlefield
      ].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function relatedOpponentLegendMatches(matches: AnalyticsMatch[], selected: AnalyticsMatch): AnalyticsMatch[] {
  const opponentName = selected.opponentName.trim().toLowerCase();
  return matches.filter((match) => {
    if (match.result !== "Win" && match.result !== "Loss" && match.result !== "Draw") {
      return false;
    }
    if (match.myChampion !== selected.myChampion || match.opponentChampion !== selected.opponentChampion) {
      return false;
    }
    if (!opponentName) {
      return true;
    }
    return match.opponentName.trim().toLowerCase() === opponentName;
  });
}

function opponentLegendRecordLabel(match: AnalyticsMatch): string {
  const opponent = match.opponentName || "opponent";
  const legend = match.opponentChampion || "legend";
  return `Vs ${opponent} on ${legend}`;
}

function localMatchStats(matches: MatchDraft[]): { winRate: string; record: string; streak: string; mostPlayed: string } {
  const completed = matches.filter((match) => match.result !== "Incomplete");
  const wins = completed.filter((match) => match.result === "Win").length;
  const losses = completed.filter((match) => match.result === "Loss").length;
  const draws = completed.filter((match) => match.result === "Draw").length;
  const decisive = wins + losses;
  return {
    winRate: decisive ? `${Math.round((wins / decisive) * 100)}%` : "Pending",
    record: `${wins}-${losses}${draws ? `-${draws}` : ""}`,
    streak: currentMatchStreak(matches),
    mostPlayed: topValue(matches.map((match) => normalizeLegendName(match.myChampion)).filter(Boolean))
  };
}

function currentMatchStreak(matches: MatchDraft[]): string {
  const completed = [...matches]
    .filter((match) => match.result === "Win" || match.result === "Loss")
    .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  const latest = completed[0]?.result;
  if (!latest) {
    return "Pending";
  }
  let count = 0;
  for (const match of completed) {
    if (match.result !== latest) break;
    count += 1;
  }
  return `${latest === "Win" ? "W" : "L"}${count}`;
}

function matchInDateRange(match: MatchDraft, range: string): boolean {
  return dateInRange(match.capturedAt, range);
}

function dateInRange(capturedAt: string, range: string): boolean {
  if (range === "all") return true;
  const captured = new Date(capturedAt);
  if (Number.isNaN(captured.getTime())) return true;
  const now = new Date();
  if (range === "today") {
    return captured.toDateString() === now.toDateString();
  }
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 0;
  if (!days) return true;
  return now.getTime() - captured.getTime() <= days * 24 * 60 * 60 * 1000;
}

function filterLeaderboardMatches(matches: AnalyticsMatch[], filters: LeaderboardFilters): AnalyticsMatch[] {
  const search = filters.search.trim().toLowerCase();
  const selectedLegend = filters.legend ? normalizeLegendName(filters.legend) : "";
  return matches.filter((match) => {
    if (match.result !== "Win" && match.result !== "Loss" && match.result !== "Draw") return false;
    if (filters.format && match.format !== filters.format) return false;
    if (!dateInRange(match.capturedAt, filters.range)) return false;
    if (selectedLegend && match.myChampion !== selectedLegend && match.opponentChampion !== selectedLegend) return false;
    if (search) {
      const haystack = [
        match.myName,
        match.opponentName,
        match.myChampion,
        match.opponentChampion,
        match.deckName,
        match.platform
      ].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function sortLeaderboardRows(rows: ReturnType<typeof leaderboardRows>, sort: LeaderboardSort): ReturnType<typeof leaderboardRows> {
  return [...rows].sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "winRate") return b.winRate - a.winRate || b.games - a.games || a.name.localeCompare(b.name);
    if (sort === "games") return b.games - a.games || b.score - a.score || a.name.localeCompare(b.name);
    if (sort === "wins") return b.wins - a.wins || b.score - a.score || a.name.localeCompare(b.name);
    return b.score - a.score || b.games - a.games || a.name.localeCompare(b.name);
  });
}

function StatsView({ matches }: { matches: MatchDraft[] }) {
  const [selectedStat, setSelectedStat] = useState<StatsDrilldownSelection | null>(null);
  const [sourceFilter, setSourceFilter] = useState("");
  const [personalFilters, setPersonalFilters] = useState<MatrixFilters>(DEFAULT_MATRIX_FILTERS);
  const allAnalytics = useMemo(() => validAnalytics(matches.map(localToAnalytics)), [matches]);
  const analytics = useMemo(() => sourceFilter ? allAnalytics.filter((match) => match.source === sourceFilter) : allAnalytics, [allAnalytics, sourceFilter]);
  const personalAnalytics = useMemo(() => filterMatrixMatches(analytics, personalFilters, true), [analytics, personalFilters]);
  const hasScorepadMatches = useMemo(() => allAnalytics.some((match) => match.source === "scorepad" || match.source === "manual"), [allAnalytics]);
  const completed = useMemo(() => personalAnalytics.filter((match) => match.result !== "Incomplete"), [personalAnalytics]);
  const wins = completed.filter((match) => match.result === "Win").length;
  const losses = completed.filter((match) => match.result === "Loss").length;
  const total = completed.length;
  const winRate = total ? Math.round((wins / total) * 100) : 0;
  const mostPlayed = useMemo(() => topValue(personalAnalytics.map((match) => match.myChampion).filter(Boolean)), [personalAnalytics]);
  const mostPlayedMatches = useMemo(() => mostPlayed ? personalAnalytics.filter((match) => match.myChampion === mostPlayed) : [], [personalAnalytics, mostPlayed]);

  function setPersonalFilter(key: keyof MatrixFilters, value: string) {
    setPersonalFilters((current) => ({ ...current, [key]: value }));
    setSelectedStat(null);
  }

  function resetPersonalFilters() {
    setPersonalFilters(DEFAULT_MATRIX_FILTERS);
    setSelectedStat(null);
  }

  return (
    <section className="dashboard-page analytics-page">
      <section className="metric-grid">
        <Metric
          label="Matches"
          value={String(personalAnalytics.length)}
          onClick={() => setSelectedStat({ title: "Personal matches", subtitle: "Every captured match in this view.", matches: personalAnalytics, showFlags: true })}
        />
        <Metric
          label="Win rate"
          value={`${winRate}%`}
          onClick={() => setSelectedStat({ title: "Personal win rate", subtitle: `${completed.length} completed matches counted.`, matches: completed, showFlags: true })}
        />
        <Metric
          label="Record"
          value={`${wins}-${losses}`}
          onClick={() => setSelectedStat({ title: "Personal record", subtitle: "Completed wins, losses, and draws from local history.", matches: completed, showFlags: true })}
        />
        <Metric
          label="Most played"
          value={mostPlayed || "Pending"}
          onClick={mostPlayedMatches.length ? () => setSelectedStat({ title: `${mostPlayed} personal stats`, subtitle: "Matches where this was your legend.", matches: mostPlayedMatches, primaryLegend: mostPlayed, showFlags: true }) : undefined}
        />
      </section>
      {hasScorepadMatches ? (
        <section className="rail-card analytics-source-card">
          <div className="filters-title">
            <h2>Data source</h2>
            <span>{sourceFilter ? "Filtered personal view" : "Auto captured and Scorepad combined"}</span>
          </div>
          <label>
            Source
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="">All personal matches</option>
              <option value="capture">Auto captured only</option>
              <option value="scorepad">Scorepad only</option>
            </select>
          </label>
        </section>
      ) : null}
      {selectedStat ? <StatsDrilldown {...selectedStat} onClose={() => setSelectedStat(null)} /> : null}
      <AnalyticsSuite
        title="Personal stats"
        matches={analytics}
        filteredMatches={personalAnalytics}
        filters={personalFilters}
        emptyText="Log matches with both legends filled in to build your personal matrix."
        onFilterChange={setPersonalFilter}
        onResetFilters={resetPersonalFilters}
      />
    </section>
  );
}

function StreamView({
  overlayInfo,
  matches,
  decks,
  settings,
  onSaveSettings
}: {
  overlayInfo: OverlayInfo | null;
  matches: MatchDraft[];
  decks: SavedDeck[];
  settings: UserSettings;
  onSaveSettings: (patch: Partial<UserSettings>) => Promise<void>;
}) {
  const [previewLayout, setPreviewLayout] = useState<"landscape" | "portrait">("landscape");
  const [overlayActionStatus, setOverlayActionStatus] = useState("");
  const latest = matches[0];
  const landscapeUrl = overlayInfo?.landscapeUrl || overlayInfo?.url || "";
  const portraitUrl = overlayInfo?.portraitUrl || "";
  const selectedOverlayUrl = previewLayout === "portrait" ? portraitUrl : landscapeUrl;
  const overlayDisplay = overlayDisplayOptions(settings.overlayDisplay);
  const sessionStart = overlaySessionStartDate(settings.overlaySessionStartedAt);
  const sessionStartMs = sessionStart.date.getTime();
  const sessionMatches = useMemo(
    () => matches.filter((match) => match.result !== "Incomplete" && new Date(match.capturedAt).getTime() >= sessionStartMs),
    [matches, sessionStartMs]
  );
  const sessionWins = sessionMatches.filter((match) => match.result === "Win").length;
  const sessionLosses = sessionMatches.filter((match) => match.result === "Loss").length;
  const sessionDraws = sessionMatches.filter((match) => match.result === "Draw").length;
  const sessionRecord = `${sessionWins}-${sessionLosses}${sessionDraws ? `-${sessionDraws}` : ""}`;
  const latestMyLegend = latest ? normalizeLegendName(latest.myChampion) : "";
  const latestOpponentLegend = latest ? normalizeLegendName(latest.opponentChampion) : "";
  const completed = useMemo(() => validAnalytics(matches.map(localToAnalytics)).filter((match) => match.result !== "Incomplete"), [matches]);
  const legendStats = useMemo(() => overlayPreviewStats(completed.filter((match) => match.myChampion === latestMyLegend)), [completed, latestMyLegend]);
  const matchupStats = useMemo(
    () => overlayPreviewStats(completed.filter((match) => match.myChampion === latestMyLegend && match.opponentChampion === latestOpponentLegend)),
    [completed, latestMyLegend, latestOpponentLegend]
  );
  const activeDeck = useMemo(() => decks.find((deck) => deck.id === settings.activeDeckId) ?? null, [decks, settings.activeDeckId]);
  const activeDeckPerformance = useMemo(() => activeDeck ? buildDeckPerformance(activeDeck, matches, new Date(sessionStartMs)) : null, [activeDeck, matches, sessionStartMs]);
  const activeDeckStats = useMemo(() => activeDeckPerformance ? activeDeckOverlayStats(activeDeckPerformance, new Date(sessionStartMs)) : null, [activeDeckPerformance, sessionStartMs]);
  const profile = OVERLAY_PROFILE_PRESETS[overlayDisplay.profile] ?? OVERLAY_PROFILE_PRESETS.grind;
  const previewColumns = overlayPreviewGridColumns(overlayDisplay);
  const presetEntries = Object.entries(OVERLAY_PROFILE_PRESETS) as Array<[OverlayProfile, typeof OVERLAY_PROFILE_PRESETS[OverlayProfile]]>;
  const textOutputRows = [
    { key: "liveSummary", label: "Live summary" },
    { key: "matchup", label: "Legends" },
    { key: "score", label: "Score" },
    { key: "battlefields", label: "Battlefields" },
    { key: "sessionRecord", label: "Session record" },
    { key: "activeDeck", label: "Active deck" }
  ];
  const optionGroups: Array<{ title: string; options: Array<{ key: OverlayBooleanOption; label: string }> }> = [
    { title: "Brand", options: [
      { key: "showWebsite", label: "RiftLite.com" },
      { key: "showFooter", label: "Captured automatically footer" }
    ] },
    { title: "Match", options: [
      { key: "showSession", label: "Session record" },
      { key: "showLatestMatch", label: "Latest matchup" },
      { key: "showResult", label: "Result pill" },
      { key: "showOpponentName", label: "Opponent name" },
      { key: "showScore", label: "Score" },
      { key: "showPlatform", label: "Platform" },
      { key: "showDeck", label: "Deck name" }
    ] },
    { title: "Stats", options: [
      { key: "showLegendWinRate", label: "Legend winrate" },
      { key: "showMatchupWinRate", label: "Into opponent winrate" },
      { key: "showActiveDeckStats", label: "Active deck panel" },
      { key: "showDeckSessionStats", label: "Deck session record" },
      { key: "showDeckMatchups", label: "Best and worst deck matchups" }
    ] }
  ];

  function patchOverlayOption(key: OverlayBooleanOption, checked: boolean) {
    void onSaveSettings({ overlayDisplay: { ...overlayDisplay, [key]: checked, showBranding: true } });
  }

  function resetSession() {
    void onSaveSettings({ overlaySessionStartedAt: new Date().toISOString() });
  }

  function applyProfile(nextProfile: OverlayProfile) {
    void onSaveSettings({ overlayDisplay: { ...OVERLAY_PROFILE_PRESETS[nextProfile].options, showBranding: true } });
  }

  async function copyOverlayUrl(url: string, label: string) {
    if (!url) {
      setOverlayActionStatus("Overlay server is still starting.");
      return;
    }
    await navigator.clipboard.writeText(url).catch(() => undefined);
    setOverlayActionStatus(`${label} OBS URL copied.`);
  }

  async function openOverlayUrl(url: string, label: string) {
    if (!url) {
      setOverlayActionStatus("Overlay server is still starting.");
      return;
    }
    await window.riftlite.openExternalResource(url);
    setOverlayActionStatus(`${label} overlay opened.`);
  }

  async function copyTextOutputPath(path: string, label: string) {
    if (!path) {
      setOverlayActionStatus("Text files are still being prepared.");
      return;
    }
    await navigator.clipboard.writeText(path).catch(() => undefined);
    setOverlayActionStatus(`${label} text path copied.`);
  }

  async function openTextOutputFolder() {
    await window.riftlite.openOverlayTextFolder();
    setOverlayActionStatus("Overlay text folder opened.");
  }

  const renderOverlayPreview = (layout: "landscape" | "portrait") => (
    <div
      className={`overlay-preview ${layout === "portrait" ? "portrait-preview" : "landscape-preview"}`}
      data-profile={overlayDisplay.profile}
      style={layout === "landscape" ? { gridTemplateColumns: previewColumns } : undefined}
    >
      <div className="overlay-brand-preview">
        <strong>RiftLite</strong>
        {overlayDisplay.showWebsite ? <span>RiftLite.com</span> : null}
      </div>
      {overlayDisplay.showSession ? <div className="overlay-session-preview">
        <span>Current session</span>
        <strong>{sessionRecord}</strong>
        <em>{sessionMatches.length} {sessionStart.reset ? "since reset" : "today"}</em>
      </div> : null}
      {overlayDisplay.showLatestMatch ? <div className="overlay-match-preview">
        {overlayDisplay.showResult ? <span>{latest?.result || "Waiting"}</span> : null}
        <strong>{latest ? `${latestMyLegend || "Unknown"} vs ${latestOpponentLegend || "Unknown"}` : "Waiting for match"}</strong>
        <em>{streamMatchMeta(latest, overlayDisplay)}</em>
      </div> : null}
      {(overlayDisplay.showLegendWinRate || overlayDisplay.showMatchupWinRate) ? (
        <div className="overlay-preview-stats-stack">
          {overlayDisplay.showLegendWinRate ? <div className="overlay-stat-preview">
            <span>Legend WR</span>
            <strong>{legendStats.winRate}</strong>
            <em>{legendStats.record}</em>
          </div> : null}
          {overlayDisplay.showMatchupWinRate ? <div className="overlay-stat-preview">
            <span>Into opponent</span>
            <strong>{matchupStats.winRate}</strong>
            <em>{matchupStats.record}</em>
          </div> : null}
        </div>
      ) : null}
      {overlayDisplay.showActiveDeckStats ? <ActiveDeckOverlayPreview stats={activeDeckStats} display={overlayDisplay} /> : null}
    </div>
  );

  return (
    <section className="dashboard-page stream-page">
      <section className="stream-studio-grid">
        <section className="rail-card stream-preview-panel">
          <div className="stream-panel-header">
            <div>
              <h2>Overlay preview</h2>
              <p className="muted">{profile.label} - {profile.description}</p>
            </div>
            <div className="scorepad-mode-toggle">
              <button className="segmented" data-active={previewLayout === "landscape"} onClick={() => setPreviewLayout("landscape")}>Landscape</button>
              <button className="segmented" data-active={previewLayout === "portrait"} onClick={() => setPreviewLayout("portrait")}>Portrait</button>
            </div>
          </div>
          <div className={`stream-preview-stage ${previewLayout}`}>
            {renderOverlayPreview(previewLayout)}
          </div>
          <section className="overlay-options-card stream-inline-controls">
            <div className="filters-title">
              <h2>Overlay controls</h2>
              <span>Preset first, then tweak what appears</span>
            </div>
            <div className="overlay-preset-grid">
              {presetEntries.map(([key, preset]) => (
                <button
                  type="button"
                  className="overlay-preset-card"
                  data-active={overlayDisplay.profile === key}
                  key={key}
                  onClick={() => applyProfile(key)}
                >
                  <strong>{preset.label}</strong>
                  <span>{preset.description}</span>
                </button>
              ))}
            </div>
            <div className="overlay-option-grid">
              {optionGroups.map((group) => (
                <div className="overlay-option-group" key={group.title}>
                  <strong>{group.title}</strong>
                  {group.options.map((option) => (
                    <label className="toggle-row" key={option.key}>
                      <span>{option.label}</span>
                      <input
                        type="checkbox"
                        checked={overlayDisplay[option.key]}
                        onChange={(event) => patchOverlayOption(option.key, event.target.checked)}
                      />
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </section>
        <aside className="stream-control-stack">
          <section className="rail-card overlay-obs-card">
            <h2>OBS source</h2>
            <p className="muted">{previewLayout === "portrait" ? "Recommended source size: 360 x 560." : "Recommended source size: 800 x 210."} Background stays transparent.</p>
            <input readOnly value={selectedOverlayUrl} aria-label={`${previewLayout} overlay URL`} />
            <div className="overlay-url-actions">
              <button className="primary" onClick={() => void copyOverlayUrl(selectedOverlayUrl, profile.label)}>Copy OBS URL</button>
              <button className="secondary" onClick={() => void openOverlayUrl(selectedOverlayUrl, profile.label)}><ExternalLink size={15} /> Open</button>
            </div>
            {overlayActionStatus ? <p className="muted">{overlayActionStatus}</p> : null}
          </section>
          <section className="rail-card overlay-text-card">
            <h2>Text file outputs</h2>
            <p className="muted">For OBS text sources: enable “Read from file”, then point each source at the file you want.</p>
            <input readOnly value={overlayInfo?.textDirectory || "Preparing text output folder..."} aria-label="Overlay text output folder" />
            <div className="overlay-url-actions">
              <button className="secondary" onClick={() => void copyTextOutputPath(overlayInfo?.textDirectory || "", "Folder")}>Copy folder</button>
              <button className="secondary" onClick={() => void openTextOutputFolder()}><FolderOpen size={15} /> Open</button>
            </div>
            <div className="overlay-text-file-grid">
              {textOutputRows.map((row) => {
                const path = overlayInfo?.textFiles?.[row.key] || "";
                return (
                  <button className="resource-link overlay-text-file-row" key={row.key} onClick={() => void copyTextOutputPath(path, row.label)}>
                    <FileText size={16} />
                    <span>
                      <strong>{row.label}</strong>
                      <em>{path ? path.split(/[\\/]/).pop() : "Preparing..."}</em>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
          <section className="rail-card stream-session-card">
            <h2>Session</h2>
            <div className="session-score">
              <strong>{sessionRecord}</strong>
              <span>{sessionMatches.length} {sessionStart.reset ? "since reset" : "today"}</span>
            </div>
            <p className="muted">Resetting only changes the stream session counter. Match history stays intact.</p>
            <button className="secondary" onClick={resetSession}><RotateCcw size={16} /> Reset session</button>
          </section>
          <section className="rail-card stream-live-card">
            <h2>On-screen state</h2>
            <Metric label="Latest match" value={latest ? `${latestMyLegend || "Unknown"} vs ${latestOpponentLegend || "Unknown"}` : "Waiting"} />
            <Metric label="Active deck" value={activeDeck?.title || "No active deck"} />
            <Metric label="Branding" value="RiftLite locked on" />
          </section>
        </aside>
      </section>
    </section>
  );
}

function ActiveDeckOverlayPreview({ stats, display }: { stats: ReturnType<typeof activeDeckOverlayStats> | null; display: OverlayDisplayOptions }) {
  if (!stats) {
    return (
      <div className="overlay-stat-preview overlay-deck-preview">
        <span>Active deck</span>
        <strong>No active deck</strong>
        <em>Set a deck active from Decks</em>
      </div>
    );
  }
  const meta = [
    `${stats.legend} - ${stats.winRate}`,
    display.showDeckSessionStats ? `Session ${stats.sessionRecord}` : "",
    display.showDeckMatchups ? `Best ${stats.bestMatchup}` : "",
    display.showDeckMatchups ? `Worst ${stats.worstMatchup}` : ""
  ].filter(Boolean);
  return (
    <div className="overlay-stat-preview overlay-deck-preview">
      <span>Active deck</span>
      <strong>{stats.title}</strong>
      <em>{stats.record} | {meta.join(" | ")}</em>
    </div>
  );
}

function overlayDisplayOptions(options: Partial<OverlayDisplayOptions> | undefined): OverlayDisplayOptions {
  return { ...DEFAULT_OVERLAY_DISPLAY, ...options, showBranding: true };
}

function overlaySessionStartDate(value: string): { date: Date; reset: boolean } {
  const resetDate = new Date(value);
  if (value && !Number.isNaN(resetDate.getTime())) {
    return { date: resetDate, reset: true };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { date: today, reset: false };
}

function streamMatchMeta(match: MatchDraft | undefined, display: OverlayDisplayOptions): string {
  if (!match) {
    return "Capture starts automatically";
  }
  const parts = [
    display.showOpponentName && match.opponentName ? `Opponent ${match.opponentName}` : "",
    display.showScore && match.score ? `Score ${match.score}` : "",
    display.showPlatform ? match.platform.toUpperCase() : "",
    display.showDeck && match.deckName ? match.deckName : ""
  ].filter(Boolean);
  return parts.join(" | ") || "Match captured";
}

function overlayPreviewGridColumns(display: OverlayDisplayOptions): string {
  const columns = ["145px"];
  if (display.showSession) {
    columns.push("118px");
  }
  if (display.showLatestMatch) {
    columns.push("minmax(0, 1fr)");
  }
  if (display.showLegendWinRate || display.showMatchupWinRate) {
    columns.push("220px");
  }
  return columns.join(" ");
}

function overlayPreviewStats(matches: AnalyticsMatch[]): { winRate: string; record: string } {
  const wins = matches.filter((match) => match.result === "Win").length;
  const losses = matches.filter((match) => match.result === "Loss").length;
  const draws = matches.filter((match) => match.result === "Draw").length;
  const decisive = wins + losses;
  return {
    winRate: matches.length ? `${decisive ? Math.round((wins / decisive) * 100) : 0}%` : "Pending",
    record: matches.length ? `${wins}-${losses}${draws ? `-${draws}` : ""} | ${matches.length} match${matches.length === 1 ? "" : "es"}` : "0 matches"
  };
}

function parseDeckSnapshot(snapshotJson: string): Record<string, unknown> {
  if (!snapshotJson.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(snapshotJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function deckEntries(snapshot: Record<string, unknown>, ...keys: string[]): Array<{ qty: number; name: string; imageUrl: string }> {
  const raw = keys.map((key) => snapshot[key]).find((value) => Array.isArray(value));
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(readDeckEntry).filter((entry) => entry.name && !looksLikeBadDeckName(entry.name));
}

function readDeckEntry(entry: unknown): { qty: number; name: string; imageUrl: string } {
  if (typeof entry === "string") {
    return { qty: 1, name: entry.trim(), imageUrl: "" };
  }
  const record = entry && typeof entry === "object" ? entry as Partial<DeckEntry> & Record<string, unknown> : {};
  const qty = Number(record.qty ?? record.quantity ?? record.count ?? 1);
  return {
    qty: Number.isFinite(qty) ? Math.max(1, Math.trunc(qty)) : 1,
    name: deckEntryText(record.name ?? record.cardName ?? record.card_name ?? record.title),
    imageUrl: deckEntryText(record.imageUrl ?? record.image_url)
  };
}

function deckEntryText(value: unknown): string {
  return String(value ?? "").trim();
}

function looksLikeBadDeckName(name: string): boolean {
  const value = name.trim();
  return !value || /^(?:x|\u00d7)?\d+$/i.test(value) || /^\/\s*\d+$/.test(value) || /^\d+\s*\/\s*\d+$/.test(value);
}

function deckNeedsRefresh(snapshot: Record<string, unknown>): boolean {
  const sections = ["runes", "battlefields", "main_deck", "mainDeck", "sideboard"];
  return sections.some((key) => Array.isArray(snapshot[key]) && (snapshot[key] as unknown[]).some((entry) => {
    const value = readDeckEntry(entry).name;
    return looksLikeBadDeckName(value);
  }));
}

function deckRawText(snapshot: Record<string, unknown>, fallbackTitle = ""): string {
  const title = deckEntryText(snapshot.title) || fallbackTitle.trim();
  const legendEntry = readDeckEntry(snapshot.legend_entry ?? snapshot.legendEntry ?? { name: snapshot.legend, qty: 1 });
  const legendName = legendEntry.name || deckEntryText(snapshot.legend) || deckEntryText(snapshot.legend_key);
  const blocks = [
    title,
    sectionText("Legend", legendName ? [{ qty: Math.max(1, legendEntry.qty || 1), name: legendName }] : []),
    sectionText("Runes", deckEntries(snapshot, "runes")),
    sectionText("Battlefields", deckEntries(snapshot, "battlefields")),
    sectionText("Main Deck", deckEntries(snapshot, "main_deck", "mainDeck")),
    sectionText("Sideboard", deckEntries(snapshot, "sideboard"))
  ].filter((block) => block.trim());
  return blocks.join("\n\n").trim();
}

function sectionText(title: string, entries: Array<{ qty: number; name: string }>): string {
  if (!entries.length) {
    return "";
  }
  return [
    title,
    ...entries.map((entry) => `${entry.qty} ${entry.name}`)
  ].join("\n");
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function DecksView({ decks, matches, settings, onDecksChanged }: { decks: SavedDeck[]; matches: MatchDraft[]; settings: UserSettings; onDecksChanged: () => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [selectedId, setSelectedId] = useState(decks[0]?.id ?? "");
  const [status, setStatus] = useState("");
  const selected = decks.find((deck) => deck.id === selectedId) ?? decks[0];

  useEffect(() => {
    if (!selectedId && decks[0]) {
      setSelectedId(decks[0].id);
    }
    if (selectedId && decks.length && !decks.some((deck) => deck.id === selectedId)) {
      setSelectedId(decks[0]?.id ?? "");
    }
  }, [decks, selectedId]);

  async function importDeck() {
    if (!url.trim()) {
      setStatus("Paste a public Piltover deck link first.");
      return;
    }
    setStatus("Importing deck...");
    try {
      const saved = await window.riftlite.importDeck(url.trim());
      setUrl("");
      setSelectedId(saved.id);
      await onDecksChanged();
      setStatus(`Imported ${saved.title}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Deck import failed.");
    }
  }

  async function refreshDeck(id: string) {
    setStatus("Refreshing deck...");
    const refreshed = await window.riftlite.refreshDeck(id);
    setSelectedId(refreshed.id);
    await onDecksChanged();
    setStatus(`Refreshed ${refreshed.title}.`);
  }

  async function setActiveDeck(id: string) {
    await window.riftlite.setActiveDeck(settings.activeDeckId === id ? "" : id);
    await onDecksChanged();
  }

  async function deleteDeck(id: string) {
    await window.riftlite.deleteDeck(id);
    setSelectedId("");
    await onDecksChanged();
    setStatus("Deck removed.");
  }

  return (
    <section className="dashboard-page decks-page">
      <section className="rail-card deck-import-card">
        <div>
          <h2>Deck library</h2>
          <p className="muted">Import public Piltover Archive links. TCGA selected decks can also attach automatically during capture.</p>
        </div>
        <div className="deck-import-row">
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://piltoverarchive.com/decks/view/..." />
          <button className="primary" onClick={() => void importDeck()}>Import deck</button>
        </div>
        {status ? <p className="muted">{status}</p> : null}
      </section>

      <section className="deck-library-layout">
        <div className="rail-card deck-list-card">
          <h2>Saved decks</h2>
          {decks.map((deck) => (
            <button className="deck-list-item interactive-row" data-active={selected?.id === deck.id} key={deck.id} onClick={() => setSelectedId(deck.id)}>
              <div>
                <strong>{deck.title}</strong>
                <span>{deck.legend || "Unknown legend"}{settings.activeDeckId === deck.id ? " - Active" : ""}</span>
              </div>
              <em>{deck.lastRefreshStatus || "Imported"}</em>
            </button>
          ))}
          {!decks.length ? <p className="muted">Imported and auto-detected decks will appear here.</p> : null}
        </div>

        <div className="rail-card deck-detail-card">
          {selected ? (
            <DeckDetail
              deck={selected}
              matches={matches}
              active={settings.activeDeckId === selected.id}
              onSetActive={() => void setActiveDeck(selected.id)}
              onRefresh={() => void refreshDeck(selected.id)}
              onDelete={() => void deleteDeck(selected.id)}
            />
          ) : (
            <p className="muted">Select a deck to view its snapshot.</p>
          )}
        </div>
      </section>
    </section>
  );
}

function DeckDetail({ deck, matches, active, onSetActive, onRefresh, onDelete }: {
  deck: SavedDeck;
  matches: MatchDraft[];
  active: boolean;
  onSetActive: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const snapshot = parseDeckSnapshot(deck.snapshotJson);
  const needsRefresh = deckNeedsRefresh(snapshot);
  const performance = useMemo(() => buildDeckPerformance(deck, matches), [deck, matches]);
  const sections = [
    ["Runes", deckEntries(snapshot, "runes")],
    ["Battlefields", deckEntries(snapshot, "battlefields")],
    ["Main deck", deckEntries(snapshot, "main_deck", "mainDeck")],
    ["Sideboard", deckEntries(snapshot, "sideboard")]
  ] as const;
  const totalCards = deckEntries(snapshot, "main_deck", "mainDeck").reduce((total, entry) => total + entry.qty, 0);
  return (
    <>
      <div className="deck-detail-header">
        <div>
          <h2>{deck.title}</h2>
          <span>{deck.legend || "Unknown legend"}{active ? " - Active fallback" : ""}</span>
        </div>
        <div className="row-actions">
          <button className="secondary" onClick={onSetActive}>{active ? "Clear active" : "Set active"}</button>
          <button className="secondary" onClick={onRefresh}>Refresh</button>
          {deck.sourceUrl.startsWith("http") ? <button className="secondary" onClick={() => void window.riftlite.openExternalResource(deck.sourceUrl)}>Open source</button> : null}
          <button className="secondary danger" onClick={onDelete}>Remove</button>
        </div>
      </div>
      <div className="drilldown-grid">
        <Metric label="Main deck" value={`${totalCards} cards`} />
        <Metric label="Runes" value={String(deckEntries(snapshot, "runes").length)} />
        <Metric label="Battlefields" value={String(deckEntries(snapshot, "battlefields").length)} />
        <Metric label="Status" value={deck.lastRefreshError || deck.lastRefreshStatus || "Imported"} />
      </div>
      {needsRefresh ? (
        <div className="deck-refresh-warning">
          This deck was imported by the older parser. Refresh it to rebuild the card names and Piltover images.
        </div>
      ) : null}
      <DeckCodePanel
        title={deck.title}
        sourceUrl={deck.sourceUrl}
        snapshotJson={deck.snapshotJson}
      />
      <DeckPerformancePanel performance={performance} />
      <div className="deck-section-grid">
        {sections.map(([title, entries]) => (
          <section className="deck-section" key={title}>
            <h3>{title}</h3>
            {entries.map((entry) => <DeckEntryRow entry={entry} key={`${title}:${entry.name}`} />)}
            {!entries.length ? <p className="muted">No cards recorded.</p> : null}
          </section>
        ))}
      </div>
    </>
  );
}

function DeckPerformancePanel({ performance }: { performance: DeckPerformanceStats }) {
  const [selectedMatch, setSelectedMatch] = useState<AnalyticsMatch | null>(null);
  const analytics = useMemo(() => validAnalytics(performance.matches.map(localToAnalytics)), [performance.matches]);
  const recent = useMemo(() => performance.recentMatches.map(localToAnalytics), [performance.recentMatches]);
  const lastPlayed = performance.overview.lastPlayed ? new Date(performance.overview.lastPlayed).toLocaleDateString() : "Never";

  return (
    <section className="deck-performance-panel">
      <div className="deck-performance-heading">
        <div>
          <h3>Performance</h3>
          <span>Local captured matches only. Pending reviews show in recent matches, but never count toward win rate.</span>
        </div>
        <strong>{performance.overview.total} completed</strong>
      </div>
      <div className="drilldown-grid deck-performance-overview">
        <Metric label="Games" value={String(performance.overview.total)} />
        <Metric label="Record" value={performance.overview.record} />
        <Metric label="Win rate" value={performance.overview.winRateLabel} />
        <Metric label="BO1 / BO3" value={`${performance.overview.bo1} / ${performance.overview.bo3}`} />
        <Metric label="Streak" value={performance.overview.currentStreak} />
        <Metric label="Last played" value={lastPlayed} />
      </div>

      <div className="deck-trend-grid">
        {performance.trends.map((trend) => (
          <div className="deck-trend-card" data-trend={trend.label} key={trend.window}>
            <span>Last {trend.window}</span>
            <strong>{trend.label}</strong>
            <em>{trend.record} | {trend.winRateLabel}</em>
          </div>
        ))}
      </div>

      <section className="two-column deck-performance-splits">
        <div className="compact-panel">
          <h3>Seat stats</h3>
          {performance.seatStats.map((seat) => <PerformanceStatRow key={seat.seat} label={`Went ${seat.seat}`} stats={seat} />)}
          {!performance.seatStats.length ? <p className="muted">Seat data appears after reviewed matches include first or second.</p> : null}
        </div>
        <div className="compact-panel">
          <h3>Battlefield pairs</h3>
          {performance.battlefieldPairs.slice(0, 6).map((pair) => (
            <PerformanceStatRow key={`${pair.myBattlefield}:${pair.opponentBattlefield}`} label={`${pair.myBattlefield} vs ${pair.opponentBattlefield}`} stats={pair} />
          ))}
          {!performance.battlefieldPairs.length ? <p className="muted">Battlefield pair stats appear when both sides are known.</p> : null}
        </div>
      </section>

      <section className="two-column deck-performance-splits">
        <BattlefieldStatsList title="My battlefield WR" rows={performance.myBattlefields} />
        <BattlefieldStatsList title="Opponent battlefield WR" rows={performance.opponentBattlefields} />
      </section>

      <section className="compact-panel deck-recent-panel">
        <h3>Recent deck matches</h3>
        {recent.map((match) => (
          <button
            type="button"
            className="event-row recent-match-row interactive-row"
            data-active={selectedMatch?.id === match.id}
            key={match.id}
            onClick={() => setSelectedMatch((current) => current?.id === match.id ? null : match)}
          >
            <span>
              <strong>{match.result}{match.score ? ` ${match.score}` : ""} vs {match.opponentChampion || "Unknown"}</strong>
              <em>{new Date(match.capturedAt).toLocaleDateString()} - {match.format} - {match.opponentName || "Unknown opponent"}</em>
            </span>
            <strong>{match.result === "Incomplete" ? "Pending" : match.myChampion}</strong>
          </button>
        ))}
        {!recent.length ? <p className="muted">No local matches are linked to this deck yet.</p> : null}
        {selectedMatch ? <MatchDetailPanel match={selectedMatch} /> : null}
      </section>

      <MatchupMatrixPanel matches={analytics} emptyText="Deck matchups appear after this deck has completed matches with both legends recorded." showFlags={false} />
    </section>
  );
}

function BattlefieldStatsList({ title, rows }: { title: string; rows: DeckBattlefieldStat[] }) {
  return (
    <div className="compact-panel">
      <h3>{title}</h3>
      {rows.slice(0, 8).map((row) => <PerformanceStatRow key={row.name} label={row.name} stats={row} />)}
      {!rows.length ? <p className="muted">No battlefield data yet.</p> : null}
    </div>
  );
}

function PerformanceStatRow({ label, stats }: { label: string; stats: DeckRecordStats | DeckBattlefieldPairStat }) {
  return (
    <div className="browser-row performance-stat-row">
      <strong>{label}</strong>
      <span>{stats.winRateLabel} | {stats.record} | {stats.total} game{stats.total === 1 ? "" : "s"}</span>
    </div>
  );
}

function DeckCodePanel({ title, sourceUrl, snapshotJson, compact = false }: {
  title: string;
  sourceUrl?: string;
  snapshotJson: string;
  compact?: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const snapshot = parseDeckSnapshot(snapshotJson);
  const rawText = deckRawText(snapshot, title);
  if (!rawText) {
    return null;
  }

  async function copyDeckCode() {
    await copyTextToClipboard(rawText);
    setCopyStatus("Copied");
    window.setTimeout(() => setCopyStatus(""), 1600);
  }

  return (
    <section className={`deck-code-panel ${compact ? "compact" : ""}`}>
      <header>
        <div>
          <h3>{title || deckEntryText(snapshot.title) || "Deck list"}</h3>
          <span>{copyStatus || "Raw deck text"}</span>
        </div>
        <div className="row-actions">
          <button className="secondary" onClick={() => void copyDeckCode()}>Copy deck code</button>
          {sourceUrl?.startsWith("http") ? <button className="secondary" onClick={() => void window.riftlite.openExternalResource(sourceUrl)}>Open source</button> : null}
        </div>
      </header>
      <textarea readOnly value={rawText} />
    </section>
  );
}

function DeckEntryRow({ entry }: { entry: { qty: number; name: string; imageUrl: string } }) {
  return (
    <div className="deck-entry-row">
      {entry.imageUrl ? <img src={entry.imageUrl} alt="" loading="lazy" /> : <span className="deck-entry-placeholder">{entry.name.slice(0, 1)}</span>}
      <strong>{entry.qty}x</strong>
      <span>{entry.name}</span>
    </div>
  );
}

function ReplayView({
  replays,
  matches,
  settings,
  focusReplayId,
  onFocusConsumed,
  onReplaysChanged,
  onDeleteReplay
}: {
  replays: ReplayRecord[];
  matches: MatchDraft[];
  settings: UserSettings;
  focusReplayId: string;
  onFocusConsumed: () => void;
  onReplaysChanged: (focusReplayId?: string) => Promise<void>;
  onDeleteReplay: (id: string) => Promise<void>;
}) {
  const [platformFilter, setPlatformFilter] = useState<"all" | GamePlatform>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedReplayId, setSelectedReplayId] = useState("");
  const [status, setStatus] = useState("");
  const [visibleReplayCount, setVisibleReplayCount] = useState(REPLAY_LIST_PAGE_SIZE);
  const matchById = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  const replayItems = useMemo(() => replays.map((replay) => replayListItem(replay, matchById.get(replay.matchId) ?? replay.matchSnapshot)), [matchById, replays]);
  const filteredItems = useMemo(
    () => {
      const needle = deferredSearch.trim().toLowerCase();
      return replayItems.filter((item) => {
        if (platformFilter !== "all" && item.replay.platform !== platformFilter) {
          return false;
        }
        return !needle || item.searchText.includes(needle);
      });
    },
    [deferredSearch, platformFilter, replayItems]
  );
  const selectedItem = filteredItems.find((item) => item.replay.id === selectedReplayId) ?? filteredItems[0] ?? null;
  const selectedIndex = selectedItem ? filteredItems.findIndex((item) => item.replay.id === selectedItem.replay.id) : -1;
  const visibleLimit = Math.max(visibleReplayCount, selectedIndex + 1);
  const visibleReplayItems = filteredItems.slice(0, visibleLimit);
  const selectedModel = useMemo(() => selectedItem ? buildAtlasReplay(selectedItem.replay, selectedItem.match) : null, [selectedItem]);

  useEffect(() => {
    setVisibleReplayCount(REPLAY_LIST_PAGE_SIZE);
  }, [deferredSearch, platformFilter]);

  useEffect(() => {
    if (!focusReplayId) {
      return;
    }
    setSearch("");
    setPlatformFilter("all");
    setSelectedReplayId(focusReplayId);
    onFocusConsumed();
  }, [focusReplayId, onFocusConsumed]);

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedReplayId("");
      return;
    }
    if (!filteredItems.some((item) => item.replay.id === selectedReplayId)) {
      setSelectedReplayId(filteredItems[0].replay.id);
    }
  }, [filteredItems, selectedReplayId]);

  async function importReplay() {
    setStatus("Importing replay...");
    const imported = await window.riftlite.importReplayBundle();
    if (!imported) {
      setStatus("");
      return;
    }
    await onReplaysChanged(imported.id);
    setStatus("Replay imported.");
  }

  async function importReplayFolder() {
    setStatus("Importing replay folder...");
    const imported = await window.riftlite.importReplayFolder();
    if (!imported.length) {
      setStatus("");
      return;
    }
    await onReplaysChanged(imported[0]?.id);
    setStatus(`Imported ${imported.length} replay${imported.length === 1 ? "" : "s"}.`);
  }

  async function exportReplay(replayId: string) {
    setStatus("Exporting replay...");
    const exportedPath = await window.riftlite.exportReplayBundle(replayId);
    setStatus(exportedPath ? `Exported ${exportedPath}` : "");
  }

  async function saveReplay(replay: ReplayRecord) {
    setStatus("Saving replay...");
    const saved = await window.riftlite.saveReplay(replay);
    await onReplaysChanged(saved.id);
    setStatus("Replay saved.");
  }

  if (!replays.length) {
    return (
      <section className="dashboard-page replay-coming-soon">
        <div className="rail-card replay-placeholder">
          <History size={34} />
          <h2>No replays captured yet</h2>
          <p>{settings.replayCaptureEnabled ? "Replay evidence will appear here after captured matches." : "Replay capture is currently off in Settings."}</p>
          <div className="row-actions centered-actions">
            <button className="secondary" onClick={() => void importReplay()}><FolderOpen size={16} /> Import replay</button>
            <button className="secondary" onClick={() => void window.riftlite.openReplayFolder()}><FolderOpen size={16} /> Replay folder</button>
          </div>
          {status ? <p className="muted">{status}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-page replay-page">
      <aside className="rail-card replay-browser">
        {!settings.replayCaptureEnabled ? (
          <div className="replay-disabled-banner">
            <strong>Replay capture is off</strong>
            <span>Saved replays stay viewable, but new matches will not store replay evidence.</span>
          </div>
        ) : null}
        <div className="replay-browser-header">
          <div>
            <h2>Replays</h2>
            <span>{visibleReplayItems.length} of {filteredItems.length} shown</span>
          </div>
          <select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value as "all" | GamePlatform)}>
            <option value="all">All</option>
            <option value="atlas">Atlas</option>
            <option value="tcga">TCGA</option>
          </select>
        </div>
        <div className="replay-search-panel">
          <label>
            Search replay data
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Legend, player, battlefield, deck..."
            />
          </label>
          <div className="row-actions">
            <button className="secondary" onClick={() => void importReplay()}><FolderOpen size={14} /> Import</button>
            <button className="secondary" onClick={() => void importReplayFolder()}><FolderOpen size={14} /> Folder</button>
            <button className="secondary" onClick={() => void window.riftlite.openReplayFolder()}><FolderOpen size={14} /></button>
          </div>
          {status ? <span className="replay-status-text">{status}</span> : null}
        </div>
        <div className="replay-list">
          {visibleReplayItems.map((item) => (
            <button
              type="button"
              className="replay-item"
              data-active={selectedItem?.replay.id === item.replay.id}
              key={item.replay.id}
              onClick={() => setSelectedReplayId(item.replay.id)}
            >
              <strong>{item.title}</strong>
              <span>{item.platformLabel} - {new Date(item.capturedAt).toLocaleString()}</span>
              <em>{item.players.me || "Player"} vs {item.players.opponent || "Opponent"}</em>
              <small>{item.chips.join(" | ")}</small>
            </button>
          ))}
          {visibleReplayItems.length < filteredItems.length ? (
            <button
              type="button"
              className="secondary replay-load-more"
              onClick={() => setVisibleReplayCount((current) => current + REPLAY_LIST_PAGE_SIZE)}
            >
              Show {Math.min(REPLAY_LIST_PAGE_SIZE, filteredItems.length - visibleReplayItems.length)} more
            </button>
          ) : null}
          {!filteredItems.length ? <p className="muted">No replays match this filter.</p> : null}
        </div>
      </aside>

      {selectedModel ? (
        <ReplayDetail
          model={selectedModel}
          settings={settings}
          onExport={() => void exportReplay(selectedModel.replay.id)}
          onSaveReplay={saveReplay}
          onDeleteReplay={() => void onDeleteReplay(selectedModel.replay.id)}
        />
      ) : null}
    </section>
  );
}

type ReplayListItem = {
  replay: ReplayRecord;
  match?: MatchDraft;
  title: string;
  platformLabel: string;
  capturedAt: string;
  players: { me: string; opponent: string };
  chips: string[];
  searchText: string;
};

function replayListItem(replay: ReplayRecord, match?: MatchDraft): ReplayListItem {
  const metadata = replay.search;
  const myLegend = normalizeLegendName(match?.myChampion ?? metadata?.legends?.[0] ?? "");
  const opponentLegend = normalizeLegendName(match?.opponentChampion ?? metadata?.legends?.[1] ?? "");
  const battlefields = metadata?.battlefields?.length
    ? metadata.battlefields
    : [match?.myBattlefield, match?.opponentBattlefield].filter(Boolean) as string[];
  const players = {
    me: replay.players?.me || match?.myName || "Player",
    opponent: replay.players?.opponent || match?.opponentName || "Opponent"
  };
  const title = replay.title || [myLegend || "Replay", opponentLegend].filter(Boolean).join(" vs ");
  const chips = [
    match?.format || metadata?.format || "Replay",
    replay.video ? "Video" : "",
    [myLegend, opponentLegend].filter(Boolean).join(" vs "),
    battlefields.slice(0, 2).join(", ")
  ].filter(Boolean);
  const searchValues = [
    title,
    replay.platform,
    players.me,
    players.opponent,
    myLegend,
    opponentLegend,
    match?.deckName,
    match?.format,
    match?.games.map((game) => [game.myBattlefield, game.oppBattlefield, game.extraBattlefields?.join(" "), game.result, game.wentFirst].join(" ")).join(" "),
    metadata?.players.join(" "),
    metadata?.legends.join(" "),
    metadata?.battlefields.join(" "),
    metadata?.deckName,
    replay.flags?.map((flag) => [flag.label, flag.customType, flag.note, flag.targetLabel].join(" ")).join(" "),
    replay.annotations?.map((annotation) => [annotation.tool, annotation.text, annotation.note, annotation.targetLabel].join(" ")).join(" "),
    replay.voiceNotes?.length ? "voice notes coaching audio" : ""
  ];
  return {
    replay,
    match,
    title,
    platformLabel: replay.platform === "tcga" ? "TCGA" : "RiftAtlas",
    capturedAt: replay.capturedAt || match?.capturedAt || new Date().toISOString(),
    players,
    chips,
    searchText: searchValues.filter(Boolean).join(" ").toLowerCase()
  };
}

function ReplayFlagPanel({
  flags,
  flagType,
  flagCustomType,
  flagNote,
  replay,
  onFlagTypeChange,
  onFlagCustomTypeChange,
  onFlagNoteChange,
  onAddReplayFlag,
  onOpenFlag,
  onRemoveFlag
}: {
  flags: ReplayFlag[];
  flagType: ReplayFlagType;
  flagCustomType: string;
  flagNote: string;
  replay: ReplayRecord;
  onFlagTypeChange: (value: ReplayFlagType) => void;
  onFlagCustomTypeChange: (value: string) => void;
  onFlagNoteChange: (value: string) => void;
  onAddReplayFlag: () => void;
  onOpenFlag: (flag: ReplayFlag) => void;
  onRemoveFlag: (id: string) => void;
}) {
  const sortedFlags = [...flags].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  return (
    <section className="rail-card replay-flag-panel">
      <header>
        <div>
          <h2>Replay flags</h2>
          <span>{flags.length ? `${flags.length} marked moment${flags.length === 1 ? "" : "s"}` : "Mark frames or the full replay"}</span>
        </div>
      </header>
      <div className="replay-flag-compose">
        <label>
          Type
          <select value={flagType} onChange={(event) => onFlagTypeChange(event.target.value as ReplayFlagType)}>
            {REPLAY_FLAG_TYPES.map((type) => (
              <option value={type.value} key={type.value}>{type.label}</option>
            ))}
          </select>
        </label>
        {flagType === "custom" ? (
          <label>
            Custom label
            <input value={flagCustomType} onChange={(event) => onFlagCustomTypeChange(event.target.value)} placeholder="Coach label..." />
          </label>
        ) : null}
        <label>
          Note
          <input value={flagNote} onChange={(event) => onFlagNoteChange(event.target.value)} placeholder="Optional note..." />
        </label>
        <div className="row-actions">
          <button type="button" className="secondary" onClick={onAddReplayFlag}><Flag size={14} /> Flag replay</button>
        </div>
      </div>
      <div className="replay-flag-list">
        {sortedFlags.map((flag) => (
          <div className="replay-flag-row" data-target={flag.targetType} key={flag.id}>
            <button type="button" onClick={() => onOpenFlag(flag)}>
              <Flag size={14} />
              <span>
                <strong>{replayFlagTypeLabel(flag)}</strong>
                <em>{flag.targetType === "replay" ? replay.title : flag.targetLabel} - {flag.timeMs != null ? formatDuration(flag.timeMs) : new Date(flag.capturedAt).toLocaleTimeString()}</em>
                {flag.note ? <small>{flag.note}</small> : null}
              </span>
            </button>
            <button type="button" className="icon-button" onClick={() => onRemoveFlag(flag.id)} title="Remove replay flag">
              <X size={14} />
            </button>
          </div>
        ))}
        {!sortedFlags.length ? <p className="muted">No replay flags yet.</p> : null}
      </div>
    </section>
  );
}

function ReplayLayerPanel({
  layers,
  activeLayerId,
  visibleLayerIds,
  addingLayer,
  status,
  onActiveLayerChange,
  onToggleLayer,
  onAddLayer
}: {
  layers: ReplayTeachingLayer[];
  activeLayerId: string;
  visibleLayerIds: Set<string>;
  addingLayer: boolean;
  status: string;
  onActiveLayerChange: (layerId: string) => void;
  onToggleLayer: (layerId: string) => void;
  onAddLayer: () => void | Promise<void>;
}) {
  return (
    <section className="rail-card replay-layer-panel">
      <header>
        <div>
          <h2>Teaching layers</h2>
          <span>New flags, drawings, and voice notes save to the active layer.</span>
        </div>
        <button type="button" className="secondary" onClick={() => void onAddLayer()} disabled={addingLayer}>
          <Plus size={14} /> {addingLayer ? "Adding..." : "Add layer"}
        </button>
      </header>
      <div className="replay-layer-controls">
        <label>
          Active layer
          <select value={activeLayerId} onChange={(event) => onActiveLayerChange(event.target.value)}>
            {layers.map((layer) => (
              <option value={layer.id} key={layer.id}>{layer.name} - {layer.author}</option>
            ))}
          </select>
        </label>
        <div className="replay-layer-list">
          {layers.map((layer) => (
            <label key={layer.id}>
              <input
                type="checkbox"
                checked={visibleLayerIds.has(layer.id)}
                onChange={() => onToggleLayer(layer.id)}
              />
              <span style={{ background: layer.color }} />
              <strong>{layer.name}</strong>
              <em>{layer.author}</em>
            </label>
          ))}
        </div>
        {status ? <span className="replay-layer-status">{status}</span> : null}
      </div>
    </section>
  );
}

function ReplayDetail({
  model,
  settings,
  onExport,
  onSaveReplay,
  onDeleteReplay
}: {
  model: AtlasReplayViewModel;
  settings: UserSettings;
  onExport: () => void;
  onSaveReplay: (replay: ReplayRecord) => Promise<void>;
  onDeleteReplay: () => void;
}) {
  const analyticsMatch = model.match ? localToAnalytics(model.match) : null;
  const allScreenshots = useMemo(() => replayScreenshots(model), [model]);
  const screenshots = useMemo(() => trimmedReplayScreenshots(allScreenshots, model.replay.trim), [allScreenshots, model.replay.trim]);
  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const [slideshowIndex, setSlideshowIndex] = useState(0);
  const [videoSeekMs, setVideoSeekMs] = useState<number | null>(null);
  const [flagType, setFlagType] = useState<ReplayFlagType>("key-turn");
  const [flagCustomType, setFlagCustomType] = useState("");
  const [flagNote, setFlagNote] = useState("");
  const [editingFlag, setEditingFlag] = useState<ReplayFlag | null>(null);
  const layers = useMemo(() => replayLayersFor(model.replay, settings.username), [model.replay, settings.username]);
  const [activeLayerId, setActiveLayerId] = useState(DEFAULT_REPLAY_LAYER_ID);
  const [visibleLayerIds, setVisibleLayerIds] = useState<Set<string>>(() => new Set(layers.map((layer) => layer.id)));
  const [addingLayer, setAddingLayer] = useState(false);
  const [layerStatus, setLayerStatus] = useState("");
  const pendingLayerIdRef = useRef<string | null>(null);
  const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? layers[0];
  const layerVisible = (layerId: string | undefined) => visibleLayerIds.has(replayLayerId(layerId));
  const replayFlags = model.replay.flags ?? [];
  const replayAnnotations = model.replay.annotations ?? [];
  const replayVoiceNotes = model.replay.voiceNotes ?? [];
  const replayFlagsRef = useRef(replayFlags);
  const replayAnnotationsRef = useRef(replayAnnotations);
  const replayVoiceNotesRef = useRef(replayVoiceNotes);
  const visibleFlags = replayFlags.filter((flag) => layerVisible(flag.layerId));
  const visibleAnnotations = replayAnnotations.filter((annotation) => layerVisible(annotation.layerId));
  const visibleVoiceNotes = replayVoiceNotes.filter((note) => layerVisible(note.layerId));
  const trimSavings = replayTrimSavings(allScreenshots, screenshots);

  useEffect(() => {
    replayFlagsRef.current = replayFlags;
  }, [replayFlags]);

  useEffect(() => {
    replayAnnotationsRef.current = replayAnnotations;
  }, [replayAnnotations]);

  useEffect(() => {
    replayVoiceNotesRef.current = replayVoiceNotes;
  }, [replayVoiceNotes]);

  useEffect(() => {
    setSlideshowOpen(false);
    setSlideshowIndex(0);
    pendingLayerIdRef.current = null;
    setAddingLayer(false);
    setLayerStatus("");
    setActiveLayerId(layers.at(-1)?.id ?? DEFAULT_REPLAY_LAYER_ID);
    setVisibleLayerIds(new Set(layers.map((layer) => layer.id)));
  }, [model.replay.id]);

  useEffect(() => {
    const pendingLayerId = pendingLayerIdRef.current;
    if (pendingLayerId && layers.some((layer) => layer.id === pendingLayerId)) {
      pendingLayerIdRef.current = null;
      setActiveLayerId(pendingLayerId);
      setVisibleLayerIds((current) => new Set([...current, pendingLayerId]));
      const pendingLayer = layers.find((layer) => layer.id === pendingLayerId);
      setLayerStatus(`${pendingLayer?.name || "New layer"} selected.`);
      return;
    }
    if (!layers.some((layer) => layer.id === activeLayerId)) {
      setActiveLayerId(layers.at(-1)?.id ?? DEFAULT_REPLAY_LAYER_ID);
    }
    setVisibleLayerIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const layer of layers) {
        if (!next.has(layer.id)) {
          next.add(layer.id);
          changed = true;
        }
      }
      for (const layerId of [...next]) {
        if (!layers.some((layer) => layer.id === layerId)) {
          next.delete(layerId);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [activeLayerId, layers]);

  function openSlideshow(screenshot?: AtlasReplayViewModel["screenshots"][number]) {
    const index = screenshot
      ? allScreenshots.findIndex((item) => screenshotKey(item) === screenshotKey(screenshot))
      : trimIndexesForScreenshots(allScreenshots, model.replay.trim).start;
    setSlideshowIndex(index >= 0 ? index : 0);
    setSlideshowOpen(true);
  }

  function saveFlags(flags: ReplayFlag[]) {
    replayFlagsRef.current = flags;
    void onSaveReplay({
      ...model.replay,
      schemaVersion: 3,
      flags
    });
  }

  function saveAnnotations(annotations: ReplayAnnotation[]) {
    replayAnnotationsRef.current = annotations;
    void onSaveReplay({
      ...model.replay,
      schemaVersion: 3,
      annotations
    });
  }

  function saveVoiceNotes(voiceNotes: ReplayVoiceNote[]) {
    replayVoiceNotesRef.current = voiceNotes;
    void onSaveReplay({
      ...model.replay,
      schemaVersion: 3,
      voiceNotes
    });
  }

  function addAnnotation(annotation: ReplayAnnotation) {
    saveAnnotations([...replayAnnotationsRef.current, { ...annotation, layerId: annotation.layerId ?? activeLayerId }]);
  }

  function removeAnnotation(id: string) {
    saveAnnotations(replayAnnotations.filter((annotation) => annotation.id !== id));
  }

  function replayAnnotationBelongsToFlag(annotation: ReplayAnnotation, flag: ReplayFlag, notes: ReplayVoiceNote[]): boolean {
    const clipIds = new Set(notes.filter((note) => note.flagId === flag.id).map((note) => note.id));
    if (annotation.clipId && clipIds.has(annotation.clipId)) {
      return true;
    }
    if (flag.targetType === "frame") {
      return annotation.targetType === "frame" && annotation.targetId === flag.targetId;
    }
    if (flag.targetType === "video-time") {
      if (annotation.targetType !== "video-time") {
        return false;
      }
      if (annotation.targetId === flag.targetId) {
        return true;
      }
      if (typeof annotation.timeMs === "number" && typeof flag.timeMs === "number") {
        return Math.abs(annotation.timeMs - flag.timeMs) <= 1500;
      }
    }
    return false;
  }

  function addReplayFlag(
    targetType: ReplayFlag["targetType"],
    targetId: string,
    targetLabel: string,
    capturedAt: string,
    fallbackLabel = "Key moment"
  ) {
    const type = flagType;
    const customType = type === "custom" ? flagCustomType.trim() : "";
    const label = type === "custom" ? customType || fallbackLabel : REPLAY_FLAG_TYPES.find((item) => item.value === type)?.label || fallbackLabel;
    const exists = replayFlags.some((flag) =>
      flag.targetType === targetType &&
      flag.targetId === targetId &&
      replayLayerId(flag.layerId) === activeLayerId &&
      flag.label.toLowerCase() === label.toLowerCase()
    );
    if (exists) {
      return;
    }
    saveFlags([
      ...replayFlags,
      {
        id: crypto.randomUUID(),
        targetType,
        targetId,
        targetLabel,
        type,
        layerId: activeLayerId,
        ...(customType ? { customType } : {}),
        label,
        note: flagNote.trim(),
        capturedAt,
        createdAt: new Date().toISOString()
      }
    ]);
    setFlagNote("");
  }

  function removeReplayFlag(id: string) {
    const flag = replayFlagsRef.current.find((item) => item.id === id);
    if (!flag) {
      return;
    }
    const nextFlags = replayFlagsRef.current.filter((item) => item.id !== id);
    const nextVoiceNotes = replayVoiceNotesRef.current.filter((note) => note.flagId !== id);
    const nextAnnotations = replayAnnotationsRef.current.filter((annotation) =>
      !replayAnnotationBelongsToFlag(annotation, flag, replayVoiceNotesRef.current)
    );
    replayFlagsRef.current = nextFlags;
    replayVoiceNotesRef.current = nextVoiceNotes;
    replayAnnotationsRef.current = nextAnnotations;
    void onSaveReplay({
      ...model.replay,
      schemaVersion: 3,
      flags: nextFlags,
      annotations: nextAnnotations,
      voiceNotes: nextVoiceNotes
    });
    setEditingFlag(null);
  }

  function updateReplayFlag(nextFlag: ReplayFlag) {
    saveFlags(replayFlags.map((flag) => flag.id === nextFlag.id ? nextFlag : flag));
    setEditingFlag(null);
  }

  function saveTimelineVoiceNote(flag: ReplayFlag, voiceNote: ReplayVoiceNote) {
    const currentFlags = replayFlagsRef.current;
    const currentVoiceNotes = replayVoiceNotesRef.current;
    const flags = currentFlags.some((item) => item.id === flag.id) ? currentFlags : [...currentFlags, flag];
    const voiceNotes = [
      ...currentVoiceNotes.filter((note) => !(note.flagId === voiceNote.flagId && replayLayerId(note.layerId) === replayLayerId(voiceNote.layerId))),
      voiceNote
    ];
    replayFlagsRef.current = flags;
    replayVoiceNotesRef.current = voiceNotes;
    void onSaveReplay({
      ...model.replay,
      schemaVersion: 3,
      flags,
      annotations: replayAnnotationsRef.current,
      voiceNotes
    });
  }

  function deleteReplayVoiceNote(flagId: string, layerId: string) {
    const notesToDelete = replayVoiceNotesRef.current.filter((note) =>
      note.flagId === flagId && replayLayerId(note.layerId) === layerId
    );
    const clipIds = new Set(notesToDelete.map((note) => note.id));
    const voiceNotes = replayVoiceNotesRef.current.filter((note) =>
      !(note.flagId === flagId && replayLayerId(note.layerId) === layerId)
    );
    const annotations = replayAnnotationsRef.current.filter((annotation) =>
      !annotation.clipId || !clipIds.has(annotation.clipId)
    );
    replayVoiceNotesRef.current = voiceNotes;
    replayAnnotationsRef.current = annotations;
    void onSaveReplay({
      ...model.replay,
      schemaVersion: 3,
      annotations,
      voiceNotes
    });
  }

  function addVideoTimeFlag(timeMs: number) {
    const video = model.replay.video;
    if (!video) {
      return;
    }
    const type = flagType;
    const customType = type === "custom" ? flagCustomType.trim() : "";
    const label = type === "custom" ? customType || "Video moment" : REPLAY_FLAG_TYPES.find((item) => item.value === type)?.label || "Video moment";
    const targetId = `${video.path || video.url}:${Math.round(timeMs)}`;
    const exists = replayFlags.some((flag) =>
      flag.targetType === "video-time" &&
      flag.targetId === targetId &&
      replayLayerId(flag.layerId) === activeLayerId &&
      flag.label.toLowerCase() === label.toLowerCase()
    );
    if (exists) {
      return;
    }
    saveFlags([
      ...replayFlags,
      {
        id: crypto.randomUUID(),
        targetType: "video-time",
        targetId,
        targetLabel: `Video ${formatDuration(timeMs)}`,
        type,
        layerId: activeLayerId,
        ...(customType ? { customType } : {}),
        label,
        note: flagNote.trim(),
        capturedAt: replayVideoCapturedAt(video, timeMs),
        createdAt: new Date().toISOString(),
        timeMs
      }
    ]);
    setFlagNote("");
  }

  async function saveVideoKeyframe(dataUrl: string, timeMs: number): Promise<void> {
    const video = model.replay.video;
    if (!video) {
      return;
    }
    const label = `Video keyframe ${formatDuration(timeMs)}`;
    const frame = await window.riftlite.saveReplayVideoKeyframe({
      replayId: model.replay.id,
      dataUrl,
      label,
      capturedAt: replayVideoCapturedAt(video, timeMs)
    });
    await onSaveReplay({
      ...model.replay,
      visualFrames: [...(model.replay.visualFrames ?? []), frame]
    });
  }

  function openFlag(flag: ReplayFlag) {
    if (flag.targetType === "frame") {
      const screenshot = allScreenshots.find((item) => replayFrameTargetId(item) === flag.targetId);
      if (screenshot) {
        openSlideshow(screenshot);
      }
    } else if (flag.targetType === "video-time" && typeof flag.timeMs === "number") {
      setVideoSeekMs(flag.timeMs);
    }
  }

  function saveReplayTrim(trim: ReplayTrimRange) {
    void onSaveReplay({
      ...model.replay,
      trim
    });
  }

  function clearReplayTrim() {
    const nextReplay = { ...model.replay };
    delete nextReplay.trim;
    void onSaveReplay(nextReplay);
  }

  async function addTeachingLayer() {
    if (addingLayer) {
      return;
    }
    const name = uniqueReplayLayerName(layers, settings.username ? `${settings.username} review` : "Coach review");
    const nextLayer: ReplayTeachingLayer = {
      id: crypto.randomUUID(),
      name,
      author: settings.username || "Coach",
      color: REPLAY_ANNOTATION_COLORS[(layers.length + 1) % REPLAY_ANNOTATION_COLORS.length],
      createdAt: new Date().toISOString()
    };
    pendingLayerIdRef.current = nextLayer.id;
    setAddingLayer(true);
    setLayerStatus(`Adding ${nextLayer.name}...`);
    setVisibleLayerIds((current) => new Set([...current, nextLayer.id]));
    try {
      await onSaveReplay({
        ...model.replay,
        schemaVersion: 3,
        layers: [...layers, nextLayer]
      });
      setActiveLayerId(nextLayer.id);
      setVisibleLayerIds((current) => new Set([...current, nextLayer.id]));
      setLayerStatus(`${nextLayer.name} selected.`);
    } catch {
      pendingLayerIdRef.current = null;
      setVisibleLayerIds((current) => {
        const next = new Set(current);
        next.delete(nextLayer.id);
        return next;
      });
      setLayerStatus("Layer could not be added.");
    } finally {
      setAddingLayer(false);
    }
  }

  function toggleLayer(layerId: string) {
    setVisibleLayerIds((current) => {
      const next = new Set(current);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      if (!next.size) {
        next.add(layerId);
      }
      return next;
    });
  }

  function selectActiveLayer(layerId: string) {
    setActiveLayerId(layerId);
    setVisibleLayerIds((current) => new Set([...current, layerId]));
  }

  return (
    <div className="replay-detail-stack">
      <section className="rail-card replay-hero">
        <div>
          <span>{model.platformLabel} replay</span>
          <h2>{model.title}</h2>
          <p>{model.players.me || "Player"} vs {model.players.opponent || "Opponent"} - {new Date(model.capturedAt).toLocaleString()}</p>
        </div>
        <div className="replay-hero-actions">
          <div className="replay-status-cluster">
            <strong>{model.resultLabel || "Captured"}</strong>
            <span>{model.scoreLabel}</span>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={!allScreenshots.length}
            onClick={() => openSlideshow()}
            title={allScreenshots.length ? "Open visual replay and trim timeline" : "No replay frames captured yet"}
          >
            <Images size={16} /> Visual replay
          </button>
          <button type="button" className="secondary" onClick={onExport}>
            <ExternalLink size={16} /> Export
          </button>
          <button type="button" className="secondary danger" onClick={onDeleteReplay}>
            Delete replay
          </button>
        </div>
      </section>

      <div className="replay-metric-grid">
        <Metric label="Turns" value={String(model.turns.length)} />
        <Metric label="Events" value={String(model.events.length)} />
        <Metric label="Evidence" value={String(model.evidenceCount)} />
        <Metric label="Board cards" value={String(replaySnapshotCardCount(model.replay))} />
        <Metric label="Replay frames" value={trimSavings} />
        <Metric label="Video" value={model.replay.video ? formatBytes(model.replay.video.sizeBytes) : "Off"} />
      </div>

      <ReplayLayerPanel
        layers={layers}
        activeLayerId={activeLayerId}
        visibleLayerIds={visibleLayerIds}
        addingLayer={addingLayer}
        status={layerStatus}
        onActiveLayerChange={selectActiveLayer}
        onToggleLayer={toggleLayer}
        onAddLayer={addTeachingLayer}
      />

      {model.replay.video ? (
        <ReplayVideoPlayer
          video={model.replay.video}
          flags={visibleFlags.filter((flag) => flag.targetType === "video-time")}
          annotations={visibleAnnotations.filter((annotation) => annotation.targetType === "video-time")}
          voiceNotes={visibleVoiceNotes}
          seekToMs={videoSeekMs}
          onSeekHandled={() => setVideoSeekMs(null)}
          onFlagTime={addVideoTimeFlag}
          onEditFlag={setEditingFlag}
          onSaveKeyframe={saveVideoKeyframe}
          activeLayerId={activeLayerId}
          microphoneDeviceId={settings.microphoneDeviceId}
          onSaveTimelineVoiceNote={saveTimelineVoiceNote}
          onAddAnnotation={addAnnotation}
          onRemoveAnnotation={removeAnnotation}
        />
      ) : null}

      <ReplayFlagPanel
        flags={visibleFlags}
        flagType={flagType}
        flagCustomType={flagCustomType}
        flagNote={flagNote}
        replay={model.replay}
        onFlagTypeChange={setFlagType}
        onFlagCustomTypeChange={setFlagCustomType}
        onFlagNoteChange={setFlagNote}
        onAddReplayFlag={() => addReplayFlag("replay", model.replay.id, model.title, model.capturedAt, "Replay note")}
        onOpenFlag={(flag) => {
          openFlag(flag);
          setEditingFlag(flag);
        }}
        onRemoveFlag={removeReplayFlag}
      />

      <ReplayBattlefields model={model} />
      {analyticsMatch ? <MatchDetailPanel match={analyticsMatch} showFlags={false} /> : null}
      {slideshowOpen ? (
        <ReplaySlideshow
          title={model.title}
          players={`${model.players.me || "Player"} vs ${model.players.opponent || "Opponent"}`}
          screenshots={allScreenshots}
          flags={visibleFlags}
          annotations={visibleAnnotations.filter((annotation) => annotation.targetType === "frame")}
          voiceNotes={visibleVoiceNotes}
          initialIndex={slideshowIndex}
          trim={model.replay.trim}
          onFlagFrame={(screenshot) => addReplayFlag("frame", replayFrameTargetId(screenshot), screenshot.label, screenshot.capturedAt, "Key frame")}
          onEditFlag={setEditingFlag}
          activeLayerId={activeLayerId}
          onAddAnnotation={addAnnotation}
          onRemoveAnnotation={removeAnnotation}
          onSaveTrim={saveReplayTrim}
          onClearTrim={clearReplayTrim}
          onClose={() => setSlideshowOpen(false)}
        />
      ) : null}
      {editingFlag ? (
        <ReplayFlagEditor
          flag={editingFlag}
          voiceNotes={visibleVoiceNotes.filter((note) => note.flagId === editingFlag.id)}
          activeLayerId={activeLayerId}
          activeLayerName={activeLayer?.name ?? "Active layer"}
          microphoneDeviceId={settings.microphoneDeviceId}
          onSave={updateReplayFlag}
          onDelete={() => removeReplayFlag(editingFlag.id)}
          onSaveVoiceNote={(voiceNote) => saveVoiceNotes([
            ...replayVoiceNotes.filter((note) => !(note.flagId === editingFlag.id && replayLayerId(note.layerId) === activeLayerId)),
            voiceNote
          ])}
          onDeleteVoiceNote={() => deleteReplayVoiceNote(editingFlag.id, activeLayerId)}
          onCancel={() => setEditingFlag(null)}
        />
      ) : null}
    </div>
  );
}

function replayScreenshots(model: AtlasReplayViewModel): AtlasReplayViewModel["screenshots"] {
  const seen = new Set<string>();
  return [...model.screenshots]
    .filter((screenshot) => {
      const key = screenshotKey(screenshot);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
}

function trimmedReplayScreenshots(
  screenshots: AtlasReplayViewModel["screenshots"],
  trim?: ReplayTrimRange
): AtlasReplayViewModel["screenshots"] {
  if (!trim) {
    return screenshots;
  }
  const trimmed = screenshots.filter((screenshot) => withinTrimRange(screenshot.capturedAt, trim));
  return trimmed.length ? trimmed : screenshots;
}

function replayTrimSavings(allScreenshots: AtlasReplayViewModel["screenshots"], trimmedScreenshots: AtlasReplayViewModel["screenshots"]): string {
  if (!allScreenshots.length) {
    return "0";
  }
  if (trimmedScreenshots.length >= allScreenshots.length) {
    return `${allScreenshots.length}`;
  }
  return `${trimmedScreenshots.length}/${allScreenshots.length}`;
}

function screenshotKey(screenshot: AtlasReplayViewModel["screenshots"][number]): string {
  return `${screenshot.path || screenshot.url}|${screenshot.capturedAt}|${screenshot.label}`;
}

function replayFrameTargetId(screenshot: AtlasReplayViewModel["screenshots"][number]): string {
  return screenshotKey(screenshot);
}

function withinTrimRange(capturedAt: string, trim: ReplayTrimRange): boolean {
  const time = new Date(capturedAt).getTime();
  const start = new Date(trim.startCapturedAt).getTime();
  const end = new Date(trim.endCapturedAt).getTime();
  if (!Number.isFinite(time) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return true;
  }
  return time >= Math.min(start, end) && time <= Math.max(start, end);
}

function replayVideoCapturedAt(video: ReplayVideoAsset, timeMs: number): string {
  const base = new Date(video.startedAt).getTime();
  return new Date((Number.isFinite(base) ? base : Date.now()) + Math.max(0, timeMs)).toISOString();
}

function formatDuration(valueMs: number): string {
  const seconds = Math.max(0, Math.round(valueMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

function replayFlagTypeLabel(flag: Pick<ReplayFlag, "type" | "customType" | "label">): string {
  if (flag.type === "custom") {
    return flag.customType?.trim() || flag.label || "Custom";
  }
  return REPLAY_FLAG_TYPES.find((item) => item.value === flag.type)?.label || flag.label || "Key turn";
}

function replayFlagTypeFromLabel(label: string): ReplayFlagType {
  const normalized = label.trim().toLowerCase();
  if (normalized.includes("mistake")) return "mistake";
  if (normalized.includes("good")) return "good-line";
  if (normalized.includes("lethal")) return "missed-lethal";
  if (normalized.includes("battlefield")) return "battlefield-decision";
  if (normalized.includes("rules")) return "rules-check";
  if (normalized.includes("custom")) return "custom";
  return "key-turn";
}

function replayLayerId(value: string | undefined): string {
  return value?.trim() || DEFAULT_REPLAY_LAYER_ID;
}

function replayLayersFor(replay: ReplayRecord, username = ""): ReplayTeachingLayer[] {
  const base: ReplayTeachingLayer = {
    id: DEFAULT_REPLAY_LAYER_ID,
    name: "Original review",
    author: replay.players?.me || username || "Player",
    color: "#7df9ff",
    createdAt: replay.capturedAt || new Date().toISOString()
  };
  const layers = replay.layers?.length ? replay.layers : [base];
  return layers.some((layer) => layer.id === DEFAULT_REPLAY_LAYER_ID) ? layers : [base, ...layers];
}

function uniqueReplayLayerName(layers: ReplayTeachingLayer[], baseName: string): string {
  const trimmedBase = baseName.trim() || "Coach review";
  const existing = new Set(layers.map((layer) => layer.name.trim().toLowerCase()));
  if (!existing.has(trimmedBase.toLowerCase())) {
    return trimmedBase;
  }
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${trimmedBase} ${index}`;
    if (!existing.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${trimmedBase} ${Date.now()}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read voice note."));
    reader.readAsDataURL(blob);
  });
}

type VoiceRecorderCapture = {
  recorder: MediaRecorder;
  cleanup: () => void;
};

async function createVoiceRecorderCapture(microphoneDeviceId: string): Promise<VoiceRecorderCapture> {
  const rawAudio: MediaTrackConstraints = {
    ...(microphoneDeviceId ? { deviceId: { exact: microphoneDeviceId } } : {}),
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 48_000,
    sampleSize: 16
  };
  let sourceStream: MediaStream;
  try {
    sourceStream = await navigator.mediaDevices.getUserMedia({ audio: rawAudio });
  } catch {
    sourceStream = await navigator.mediaDevices.getUserMedia({
      audio: microphoneDeviceId ? { deviceId: { exact: microphoneDeviceId } } : true
    });
  }
  const sourceTrack = sourceStream.getAudioTracks()[0];
  await sourceTrack?.applyConstraints({
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 48_000,
    sampleSize: 16
  }).catch(() => undefined);

  let recorderStream = sourceStream;
  let audioContext: AudioContext | null = null;
  try {
    audioContext = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
    const source = audioContext.createMediaStreamSource(sourceStream);
    const gain = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(destination);
    recorderStream = destination.stream;
  } catch {
    audioContext = null;
    recorderStream = sourceStream;
  }

  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
  const recorder = new MediaRecorder(recorderStream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 128_000,
    bitsPerSecond: 128_000
  });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    sourceStream.getTracks().forEach((track) => track.stop());
    recorderStream.getTracks().forEach((track) => track.stop());
    void audioContext?.close().catch(() => undefined);
  };
  return { recorder, cleanup };
}

function replayVoiceNoteForFlag(notes: ReplayVoiceNote[], flagId: string, layerId?: string): ReplayVoiceNote | undefined {
  return notes.find((note) => note.flagId === flagId && (!layerId || replayLayerId(note.layerId) === layerId))
    ?? notes.find((note) => note.flagId === flagId);
}

function ReplayFlagEditor({
  flag,
  voiceNotes,
  activeLayerId,
  activeLayerName,
  microphoneDeviceId,
  onSave,
  onDelete,
  onSaveVoiceNote,
  onDeleteVoiceNote,
  onCancel
}: {
  flag: ReplayFlag;
  voiceNotes: ReplayVoiceNote[];
  activeLayerId: string;
  activeLayerName: string;
  microphoneDeviceId: string;
  onSave: (flag: ReplayFlag) => void;
  onDelete: () => void;
  onSaveVoiceNote: (voiceNote: ReplayVoiceNote) => void;
  onDeleteVoiceNote: () => void;
  onCancel: () => void;
}) {
  const initialType = flag.type ?? replayFlagTypeFromLabel(flag.label);
  const activeVoiceNote = voiceNotes.find((note) => replayLayerId(note.layerId) === activeLayerId);
  const [type, setType] = useState<ReplayFlagType>(initialType);
  const [customType, setCustomType] = useState(flag.customType ?? (initialType === "custom" ? flag.label : ""));
  const [note, setNote] = useState(flag.note ?? "");
  const [recording, setRecording] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderCleanupRef = useRef<(() => void) | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  useEffect(() => () => {
    recorderRef.current?.state === "recording" && recorderRef.current.stop();
    recorderCleanupRef.current?.();
  }, []);
  const save = () => {
    const typeLabel = type === "custom"
      ? customType.trim() || "Custom"
      : REPLAY_FLAG_TYPES.find((item) => item.value === type)?.label || flag.label;
    onSave({
      ...flag,
      type,
      customType: type === "custom" ? customType.trim() : "",
      label: typeLabel,
      note: note.trim(),
      updatedAt: new Date().toISOString()
    });
  };
  async function startVoiceNote() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceStatus("Voice recording is not available on this system.");
      return;
    }
    try {
      const capture = await createVoiceRecorderCapture(microphoneDeviceId);
      const recorder = capture.recorder;
      chunksRef.current = [];
      recorderCleanupRef.current = capture.cleanup;
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAtRef.current;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        recorderCleanupRef.current?.();
        recorderCleanupRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        if (!blob.size) {
          setVoiceStatus("No voice note was captured.");
          return;
        }
        void blobToDataUrl(blob)
          .then((dataUrl) => {
            onSaveVoiceNote({
              id: activeVoiceNote?.id ?? crypto.randomUUID(),
              flagId: flag.id,
              layerId: activeLayerId,
              mimeType: blob.type || "audio/webm",
              dataUrl,
              durationMs,
              sizeBytes: blob.size,
              createdAt: activeVoiceNote?.createdAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
            setVoiceStatus(`Saved voice note (${formatDuration(durationMs)}).`);
          })
          .catch(() => setVoiceStatus("Could not save voice note."));
      };
      recorder.start();
      setRecording(true);
      setVoiceStatus("Recording voice note...");
    } catch (error) {
      setRecording(false);
      recorderCleanupRef.current?.();
      recorderCleanupRef.current = null;
      setVoiceStatus(error instanceof Error ? error.message : "Microphone access was blocked.");
    }
  }
  function stopVoiceNote() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }
  return (
    <div className="modal-backdrop replay-editor-backdrop" onClick={onCancel}>
      <section className="rail-card replay-flag-editor" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>Edit replay flag</h2>
            <span>{flag.targetLabel}</span>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} title="Close flag editor">
            <X size={16} />
          </button>
        </header>
        <label>
          Type
          <select value={type} onChange={(event) => setType(event.target.value as ReplayFlagType)}>
            {REPLAY_FLAG_TYPES.map((item) => (
              <option value={item.value} key={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        {type === "custom" ? (
          <label>
            Custom label
            <input value={customType} onChange={(event) => setCustomType(event.target.value)} placeholder="Coach label..." />
          </label>
        ) : null}
        <label>
          Note
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="What should the viewer learn here?" />
        </label>
        <div className="replay-voice-note-panel">
          <div>
            <strong><Mic size={14} /> Voice note</strong>
            <span>Recording onto {activeLayerName}. Only records when you press record. Exported .riftreplay files include saved voice notes.</span>
          </div>
          {activeVoiceNote ? (
            <audio controls src={activeVoiceNote.dataUrl} />
          ) : (
            <p className="muted">No voice note attached to this flag on the active layer.</p>
          )}
          {voiceNotes.filter((note) => replayLayerId(note.layerId) !== activeLayerId).map((note) => (
            <div className="replay-voice-note-extra" key={note.id}>
              <span>Other layer note - {formatDuration(note.durationMs)}</span>
              <audio controls src={note.dataUrl} />
            </div>
          ))}
          <div className="row-actions">
            <button type="button" className={recording ? "danger" : "secondary"} onClick={() => recording ? stopVoiceNote() : void startVoiceNote()}>
              <Mic size={14} /> {recording ? "Stop recording" : activeVoiceNote ? "Re-record" : "Record"}
            </button>
            <button type="button" className="secondary danger" disabled={!activeVoiceNote || recording} onClick={onDeleteVoiceNote}>
              Delete voice
            </button>
          </div>
          {voiceStatus ? <span className="replay-status-text">{voiceStatus}</span> : null}
        </div>
        <div className="row-actions">
          <button type="button" className="primary" onClick={save}><Save size={14} /> Save flag</button>
          <button type="button" className="secondary danger" onClick={onDelete}>Delete flag</button>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

function ReplayAnnotationCanvas({
  annotations,
  targetId,
  targetLabel,
  capturedAt,
  timeMs,
  layerId,
  activeClipId,
  activeClipStartedAt,
  playbackClipId,
  playbackOffsetMs,
  onAddAnnotation,
  onRemoveAnnotation
}: {
  annotations: ReplayAnnotation[];
  targetId: string;
  targetLabel: string;
  capturedAt: string;
  timeMs?: number;
  layerId: string;
  activeClipId?: string;
  activeClipStartedAt?: number;
  playbackClipId?: string;
  playbackOffsetMs?: number;
  onAddAnnotation: (annotation: ReplayAnnotation) => void;
  onRemoveAnnotation: (id: string) => void;
}) {
  const [tool, setTool] = useState<ReplayAnnotationTool>("pen");
  const [color, setColor] = useState(REPLAY_ANNOTATION_COLORS[0]);
  const [draftPoints, setDraftPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [drawing, setDrawing] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const normalisePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)))
    };
  };
  const clipFields = (): Pick<ReplayAnnotation, "clipId" | "offsetMs"> => activeClipId
    ? {
        clipId: activeClipId,
        offsetMs: Math.max(0, Date.now() - (activeClipStartedAt ?? Date.now()))
      }
    : {};
  const start = (event: React.PointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    const point = normalisePoint(event);
    if (tool === "text") {
      const text = window.prompt("Annotation text");
      if (!text?.trim()) {
        return;
      }
      onAddAnnotation({
        id: crypto.randomUUID(),
        targetType: timeMs == null ? "frame" : "video-time",
        targetId,
        targetLabel,
        capturedAt,
        timeMs,
        tool,
        layerId,
        ...clipFields(),
        color,
        width: 2,
        points: [point],
        text: text.trim(),
        createdAt: new Date().toISOString()
      });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawing(true);
    setDraftPoints([point]);
  };
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing) {
      return;
    }
    const point = normalisePoint(event);
    setDraftPoints((points) => [...points, point]);
  };
  const finish = () => {
    if (!drawing) {
      return;
    }
    setDrawing(false);
    if (draftPoints.length < 2) {
      setDraftPoints([]);
      return;
    }
    onAddAnnotation({
      id: crypto.randomUUID(),
      targetType: timeMs == null ? "frame" : "video-time",
      targetId,
      targetLabel,
      capturedAt,
      timeMs,
      tool,
      layerId,
      ...clipFields(),
      color,
      width: tool === "highlight" ? 10 : 3,
      points: draftPoints,
      createdAt: new Date().toISOString()
    });
    setDraftPoints([]);
  };
  const syncedAnnotations = annotations.filter((annotation) => {
    if (!annotation.clipId) {
      return true;
    }
    if (annotation.clipId === activeClipId) {
      return true;
    }
    if (annotation.clipId !== playbackClipId) {
      return false;
    }
    return (annotation.offsetMs ?? 0) <= (playbackOffsetMs ?? 0);
  });
  const visibleAnnotations = draftPoints.length
    ? [...syncedAnnotations, {
        id: "draft",
        targetType: timeMs == null ? "frame" : "video-time",
        targetId,
        targetLabel,
        capturedAt,
        timeMs,
        tool,
        layerId,
        ...clipFields(),
        color,
        width: tool === "highlight" ? 10 : 3,
        points: draftPoints,
        createdAt: new Date().toISOString()
      } satisfies ReplayAnnotation]
    : syncedAnnotations;
  return (
    <div className="replay-whiteboard" data-tools-open={toolsOpen}>
      <button
        type="button"
        className="replay-whiteboard-toggle"
        data-open={toolsOpen}
        onClick={() => setToolsOpen((value) => !value)}
        title={toolsOpen ? "Hide drawing tools" : "Show drawing tools"}
      >
        <SlidersHorizontal size={16} />
        <span>Draw</span>
      </button>
      {toolsOpen ? (
        <div className="replay-whiteboard-toolbar">
          <button type="button" className="icon-button" onClick={() => setToolsOpen(false)} title="Hide drawing tools">
            <X size={14} />
          </button>
          {activeClipId ? <strong className="replay-whiteboard-sync">Syncing to voice</strong> : null}
          {playbackClipId ? <strong className="replay-whiteboard-sync">Voice playback</strong> : null}
          <label>
            Tool
            <select value={tool} onChange={(event) => setTool(event.target.value as ReplayAnnotationTool)} title="Whiteboard tool">
              {REPLAY_ANNOTATION_TOOLS.map((item) => (
                <option value={item.value} key={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <span>Colour</span>
          <div className="replay-color-picks">
            {REPLAY_ANNOTATION_COLORS.map((item) => (
              <button
                type="button"
                key={item}
                data-active={item === color}
                style={{ background: item }}
                onClick={() => setColor(item)}
                title={`Use ${item}`}
              />
            ))}
          </div>
          <button
            type="button"
            className="secondary"
            disabled={!syncedAnnotations.length}
            onClick={() => {
              const last = syncedAnnotations.at(-1);
              if (last) {
                onRemoveAnnotation(last.id);
              }
            }}
          >
            Undo mark
          </button>
        </div>
      ) : null}
      <svg
        className="replay-annotation-svg"
        data-drawing-enabled={toolsOpen}
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <defs>
          <marker id="replay-arrow-head" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="currentColor" />
          </marker>
        </defs>
        {visibleAnnotations.map((annotation) => (
          <ReplayAnnotationShape annotation={annotation} key={annotation.id} />
        ))}
      </svg>
    </div>
  );
}

function ReplayAnnotationShape({ annotation }: { annotation: ReplayAnnotation }) {
  const points = annotation.points.map((point) => `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`).join(" ");
  const first = annotation.points[0];
  const last = annotation.points.at(-1);
  if (annotation.tool === "text" && first) {
    return (
      <text x={first.x * 1000} y={first.y * 1000} fill={annotation.color} fontSize="42" fontWeight="900" dominantBaseline="middle" paintOrder="stroke" stroke="#020712" strokeWidth="10">
        {annotation.text}
      </text>
    );
  }
  if (annotation.tool === "arrow" && first && last) {
    return (
      <line
        x1={first.x * 1000}
        y1={first.y * 1000}
        x2={last.x * 1000}
        y2={last.y * 1000}
        stroke={annotation.color}
        strokeWidth={annotation.width * 3}
        strokeLinecap="round"
        markerEnd="url(#replay-arrow-head)"
      />
    );
  }
  return (
    <polyline
      points={points}
      fill="none"
      stroke={annotation.color}
      strokeWidth={annotation.width * 3}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={annotation.tool === "highlight" ? 0.48 : 0.92}
    />
  );
}

function ReplayVideoPlayer({
  video,
  flags,
  annotations,
  voiceNotes,
  seekToMs,
  onSeekHandled,
  onFlagTime,
  onEditFlag,
  onSaveKeyframe,
  activeLayerId,
  microphoneDeviceId,
  onSaveTimelineVoiceNote,
  onAddAnnotation,
  onRemoveAnnotation
}: {
  video: ReplayVideoAsset;
  flags: ReplayFlag[];
  annotations: ReplayAnnotation[];
  voiceNotes: ReplayVoiceNote[];
  seekToMs: number | null;
  onSeekHandled: () => void;
  onFlagTime: (timeMs: number) => void;
  onEditFlag: (flag: ReplayFlag) => void;
  onSaveKeyframe: (dataUrl: string, timeMs: number) => Promise<void>;
  activeLayerId: string;
  microphoneDeviceId: string;
  onSaveTimelineVoiceNote: (flag: ReplayFlag, voiceNote: ReplayVoiceNote) => void;
  onAddAnnotation: (annotation: ReplayAnnotation) => void;
  onRemoveAnnotation: (id: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceRecorderCleanupRef = useRef<(() => void) | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceStartedAtRef = useRef(0);
  const voiceTargetTimeRef = useRef(0);
  const voiceTargetFlagRef = useRef<ReplayFlag | null>(null);
  const voiceTargetClipIdRef = useRef("");
  const voicePlaybackTimerRef = useRef<number | null>(null);
  const lastTimeUpdateRef = useRef(0);
  const [playbackUrl, setPlaybackUrl] = useState(video.url);
  const [currentMs, setCurrentMs] = useState(0);
  const [status, setStatus] = useState("");
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [activeClipId, setActiveClipId] = useState<string | undefined>();
  const [activeClipStartedAt, setActiveClipStartedAt] = useState<number | undefined>();
  const [playbackClipId, setPlaybackClipId] = useState<string | undefined>();
  const [playbackOffsetMs, setPlaybackOffsetMs] = useState(0);
  const [voiceVolume, setVoiceVolume] = useState(0.9);
  const sortedFlags = [...flags].sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0));
  const currentAnnotationTarget = `${video.path || video.url}:${Math.round(currentMs / 1000)}`;
  const visibleAnnotations = annotations.filter((annotation) =>
    (Boolean(annotation.clipId) && annotation.clipId === activeClipId)
      || (Boolean(annotation.clipId) && annotation.clipId === playbackClipId)
      || (!annotation.clipId && typeof annotation.timeMs === "number" && Math.abs(annotation.timeMs - currentMs) <= 1000)
  );
  const activeLayerFlags = sortedFlags.filter((flag) => replayLayerId(flag.layerId) === activeLayerId);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setPlaybackUrl(video.url);
    setCurrentMs(0);
    lastTimeUpdateRef.current = 0;
    setStatus("Loading replay video for instant seeking...");
    void window.riftlite.loadReplayVideo(video)
      .then((buffer) => {
        if (cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([buffer], { type: video.mimeType }));
        setPlaybackUrl(objectUrl);
        setStatus("");
      })
      .catch(() => {
        if (!cancelled) {
          setPlaybackUrl(video.url);
          setStatus("Using streamed playback fallback.");
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [video.path, video.url, video.mimeType]);

  useEffect(() => () => {
    voiceRecorderRef.current?.state === "recording" && voiceRecorderRef.current.stop();
    voiceRecorderCleanupRef.current?.();
    audioRef.current?.pause();
    if (voicePlaybackTimerRef.current) {
      window.clearInterval(voicePlaybackTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (seekToMs == null || !videoRef.current) {
      return;
    }
    videoRef.current.currentTime = Math.max(0, seekToMs / 1000);
    videoRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    onSeekHandled();
  }, [seekToMs, onSeekHandled]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = voiceVolume;
    }
  }, [voiceVolume]);

  async function saveKeyframe() {
    const element = videoRef.current;
    if (!element || !element.videoWidth || !element.videoHeight) {
      setStatus("Video frame is not ready yet.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      return;
    }
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    setStatus("Saving keyframe...");
    await onSaveKeyframe(canvas.toDataURL("image/jpeg", 0.82), currentMs);
    setStatus(`Saved keyframe at ${formatDuration(currentMs)}.`);
  }

  function stopVoicePlayback() {
    if (voicePlaybackTimerRef.current) {
      window.clearInterval(voicePlaybackTimerRef.current);
      voicePlaybackTimerRef.current = null;
    }
    setPlaybackClipId(undefined);
    setPlaybackOffsetMs(0);
  }

  function playVoiceNote(note: ReplayVoiceNote, flag?: ReplayFlag) {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    stopVoicePlayback();
    audioRef.current.pause();
    audioRef.current.src = note.dataUrl;
    audioRef.current.currentTime = 0;
    audioRef.current.volume = voiceVolume;
    if (videoRef.current && typeof flag?.timeMs === "number") {
      videoRef.current.currentTime = Math.max(0, flag.timeMs / 1000);
      setCurrentMs(flag.timeMs);
      videoRef.current.pause();
    }
    setPlaybackClipId(note.id);
    setPlaybackOffsetMs(0);
    voicePlaybackTimerRef.current = window.setInterval(() => {
      setPlaybackOffsetMs(Math.round((audioRef.current?.currentTime ?? 0) * 1000));
    }, 80);
    audioRef.current.onended = () => stopVoicePlayback();
    audioRef.current.onpause = () => {
      if (audioRef.current?.ended) {
        stopVoicePlayback();
      }
    };
    void audioRef.current.play().catch(() => setStatus("Could not play voice note."));
  }

  function timelineFlagForVoice(timeMs: number): ReplayFlag {
    const nearby = activeLayerFlags.find((flag) =>
      typeof flag.timeMs === "number" && Math.abs(flag.timeMs - timeMs) <= 1500
    );
    if (nearby) {
      return nearby;
    }
    return {
      id: crypto.randomUUID(),
      targetType: "video-time",
      targetId: `${video.path || video.url}:${Math.round(timeMs)}`,
      targetLabel: `Video ${formatDuration(timeMs)}`,
      type: "key-turn",
      layerId: activeLayerId,
      label: "Key turn",
      note: "",
      capturedAt: replayVideoCapturedAt(video, timeMs),
      createdAt: new Date().toISOString(),
      timeMs
    };
  }

  async function startTimelineVoiceNote() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setStatus("Voice recording is not available on this system.");
      return;
    }
    try {
      videoRef.current?.pause();
      const capture = await createVoiceRecorderCapture(microphoneDeviceId);
      const recorder = capture.recorder;
      voiceChunksRef.current = [];
      voiceRecorderCleanupRef.current = capture.cleanup;
      voiceRecorderRef.current = recorder;
      voiceStartedAtRef.current = Date.now();
      voiceTargetTimeRef.current = currentMs;
      voiceTargetFlagRef.current = timelineFlagForVoice(currentMs);
      voiceTargetClipIdRef.current = replayVoiceNoteForFlag(voiceNotes, voiceTargetFlagRef.current.id, activeLayerId)?.id ?? crypto.randomUUID();
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          voiceChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const targetTimeMs = voiceTargetTimeRef.current;
        const durationMs = Date.now() - voiceStartedAtRef.current;
        const blob = new Blob(voiceChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const flag = voiceTargetFlagRef.current ?? timelineFlagForVoice(targetTimeMs);
        const clipId = voiceTargetClipIdRef.current || replayVoiceNoteForFlag(voiceNotes, flag.id, activeLayerId)?.id || crypto.randomUUID();
        voiceRecorderCleanupRef.current?.();
        voiceRecorderCleanupRef.current = null;
        voiceRecorderRef.current = null;
        voiceTargetFlagRef.current = null;
        voiceTargetClipIdRef.current = "";
        setRecordingVoice(false);
        setActiveClipId(undefined);
        setActiveClipStartedAt(undefined);
        if (!blob.size) {
          setStatus("No voice note was captured.");
          return;
        }
        void blobToDataUrl(blob)
          .then((dataUrl) => {
            onSaveTimelineVoiceNote(flag, {
              id: clipId,
              flagId: flag.id,
              layerId: activeLayerId,
              mimeType: blob.type || "audio/webm",
              dataUrl,
              durationMs,
              sizeBytes: blob.size,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
            setStatus(`Saved voice note at ${formatDuration(targetTimeMs)}.`);
          })
          .catch(() => setStatus("Could not save voice note."));
      };
      recorder.start();
      setRecordingVoice(true);
      setActiveClipId(voiceTargetClipIdRef.current);
      setActiveClipStartedAt(voiceStartedAtRef.current);
      setStatus(`Recording coaching note at ${formatDuration(currentMs)}. Draw now to sync marks to this audio.`);
    } catch (error) {
      setRecordingVoice(false);
      setActiveClipId(undefined);
      setActiveClipStartedAt(undefined);
      voiceRecorderCleanupRef.current?.();
      voiceRecorderCleanupRef.current = null;
      setStatus(error instanceof Error ? error.message : "Microphone access was blocked.");
    }
  }

  function stopTimelineVoiceNote() {
    if (voiceRecorderRef.current?.state === "recording") {
      voiceRecorderRef.current.stop();
    }
  }

  return (
    <section className="rail-card replay-video-panel">
      <header>
        <div>
          <h2>Video replay</h2>
          <span>{REPLAY_VIDEO_PROFILES[video.quality]?.label ?? video.quality} - {formatDuration(video.durationMs)} - {formatBytes(video.sizeBytes)}</span>
        </div>
        <div className="row-actions">
          <button type="button" className="secondary" onClick={() => onFlagTime(currentMs)}><Flag size={14} /> Flag timestamp</button>
          <button type="button" className={recordingVoice ? "danger" : "secondary"} onClick={() => recordingVoice ? stopTimelineVoiceNote() : void startTimelineVoiceNote()}>
            <Mic size={14} /> {recordingVoice ? "Stop coaching note" : "Record coaching note"}
          </button>
          <label className="replay-voice-volume" title="Voice note playback volume">
            <Volume2 size={14} />
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={voiceVolume}
              onChange={(event) => setVoiceVolume(Number.parseFloat(event.target.value) || 0)}
            />
            <span>{Math.round(voiceVolume * 100)}%</span>
          </label>
          <button type="button" className="secondary" onClick={() => void saveKeyframe()}><Save size={14} /> Save keyframe</button>
        </div>
      </header>
      {recordingVoice ? (
        <div className="replay-coaching-status" data-state="recording">
          <Mic size={15} />
          <strong>Recording synced coaching note</strong>
          <span>The replay is paused. Draw, arrow, highlight, or add text now and it will replay with this audio.</span>
        </div>
      ) : playbackClipId ? (
        <div className="replay-coaching-status" data-state="playing">
          <Mic size={15} />
          <strong>Playing coaching note</strong>
          <span>Synced drawings appear as the audio reaches them.</span>
        </div>
      ) : null}
      <div className="replay-video-stage">
        <video
          ref={videoRef}
          src={playbackUrl}
          controls
          preload="auto"
          onPlay={(event) => {
            if (recordingVoice || playbackClipId) {
              event.currentTarget.pause();
            }
          }}
          onTimeUpdate={(event) => {
            const nextMs = Math.round(event.currentTarget.currentTime * 1000);
            if (Math.abs(nextMs - lastTimeUpdateRef.current) >= 500) {
              lastTimeUpdateRef.current = nextMs;
              setCurrentMs(nextMs);
            }
          }}
        />
        <ReplayAnnotationCanvas
          annotations={visibleAnnotations}
          targetId={currentAnnotationTarget}
          targetLabel={`Video ${formatDuration(currentMs)}`}
          capturedAt={replayVideoCapturedAt(video, currentMs)}
          timeMs={currentMs}
          layerId={activeLayerId}
          activeClipId={activeClipId}
          activeClipStartedAt={activeClipStartedAt}
          playbackClipId={playbackClipId}
          playbackOffsetMs={playbackOffsetMs}
          onAddAnnotation={onAddAnnotation}
          onRemoveAnnotation={onRemoveAnnotation}
        />
      </div>
      <ReplayVideoMarkerTimeline
        video={video}
        flags={sortedFlags}
        voiceNotes={voiceNotes}
        currentMs={currentMs}
        onSeek={(timeMs) => {
          if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, timeMs / 1000);
          }
          setCurrentMs(timeMs);
        }}
        onPlayVoice={playVoiceNote}
        onEditFlag={onEditFlag}
      />
      <div className="replay-video-meta">
        <span>{video.width}x{video.height}</span>
        <span>{video.fps} fps</span>
        <span>{video.actualBitrateKbps ? `${video.actualBitrateKbps} kbps actual` : `${video.bitrateKbps} kbps target`}</span>
        <span>{video.codec || video.mimeType}</span>
        <span>{video.source === "riftreplay" ? "Imported replay video" : video.source.replace(/-/g, " ")}</span>
      </div>
      {sortedFlags.length ? (
        <div className="replay-video-flags">
          {sortedFlags.map((flag) => (
            <button
              type="button"
              key={flag.id}
              title="Click to jump, right-click to edit this flag"
              onClick={() => {
                if (videoRef.current && typeof flag.timeMs === "number") {
                  videoRef.current.currentTime = flag.timeMs / 1000;
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onEditFlag(flag);
              }}
            >
              <strong>{formatDuration(flag.timeMs ?? 0)}</strong>
              <span>{replayFlagTypeLabel(flag)}{flag.note ? ` - ${flag.note}` : ""}</span>
            </button>
          ))}
        </div>
      ) : null}
      {status ? <p className="muted">{status}</p> : null}
    </section>
  );
}

function ReplayVideoMarkerTimeline({
  video,
  flags,
  voiceNotes,
  currentMs,
  onSeek,
  onPlayVoice,
  onEditFlag
}: {
  video: ReplayVideoAsset;
  flags: ReplayFlag[];
  voiceNotes: ReplayVoiceNote[];
  currentMs: number;
  onSeek: (timeMs: number) => void;
  onPlayVoice: (note: ReplayVoiceNote, flag: ReplayFlag) => void;
  onEditFlag: (flag: ReplayFlag) => void;
}) {
  const durationMs = Math.max(1, video.durationMs || 1);
  const sortedFlags = [...flags].filter((flag) => typeof flag.timeMs === "number").sort((a, b) => (a.timeMs ?? 0) - (b.timeMs ?? 0));
  return (
    <div className="replay-marker-timeline">
      <div className="replay-marker-rail" aria-label="Replay markers">
        <span className="replay-marker-progress" style={{ width: `${Math.min(100, Math.max(0, (currentMs / durationMs) * 100))}%` }} />
        {sortedFlags.map((flag) => {
          const note = replayVoiceNoteForFlag(voiceNotes, flag.id, flag.layerId);
          const left = Math.min(100, Math.max(0, ((flag.timeMs ?? 0) / durationMs) * 100));
          return (
            <button
              type="button"
              className="replay-marker-pin"
              data-flag-type={flag.type ?? replayFlagTypeFromLabel(flag.label)}
              data-has-voice={Boolean(note)}
              style={{ left: `${left}%` }}
              key={flag.id}
              title={`${replayFlagTypeLabel(flag)}${note ? " - voice note" : ""}. Click to jump${note ? " and play" : ""}; right-click to edit.`}
              onClick={() => {
                onSeek(flag.timeMs ?? 0);
                if (note) {
                  onPlayVoice(note, flag);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onEditFlag(flag);
              }}
            >
              {note ? <Mic size={13} /> : <Flag size={13} />}
            </button>
          );
        })}
      </div>
      <div className="replay-marker-chips">
        {sortedFlags.map((flag) => {
          const note = replayVoiceNoteForFlag(voiceNotes, flag.id, flag.layerId);
          return (
            <button
              type="button"
              key={`${flag.id}:chip`}
              data-flag-type={flag.type ?? replayFlagTypeFromLabel(flag.label)}
              data-has-voice={Boolean(note)}
              onClick={() => {
                onSeek(flag.timeMs ?? 0);
                if (note) {
                  onPlayVoice(note, flag);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onEditFlag(flag);
              }}
            >
              <strong>{formatDuration(flag.timeMs ?? 0)}</strong>
              <span>{note ? <Mic size={12} /> : <Flag size={12} />} {replayFlagTypeLabel(flag)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReplaySlideshow({
  title,
  players,
  screenshots,
  flags,
  annotations,
  voiceNotes,
  initialIndex,
  trim,
  onFlagFrame,
  onEditFlag,
  activeLayerId,
  onAddAnnotation,
  onRemoveAnnotation,
  onSaveTrim,
  onClearTrim,
  onClose
}: {
  title: string;
  players: string;
  screenshots: AtlasReplayViewModel["screenshots"];
  flags: ReplayFlag[];
  annotations: ReplayAnnotation[];
  voiceNotes: ReplayVoiceNote[];
  initialIndex: number;
  trim?: ReplayTrimRange;
  onFlagFrame: (screenshot: AtlasReplayViewModel["screenshots"][number]) => void;
  onEditFlag: (flag: ReplayFlag) => void;
  activeLayerId: string;
  onAddAnnotation: (annotation: ReplayAnnotation) => void;
  onRemoveAnnotation: (id: string) => void;
  onSaveTrim: (trim: ReplayTrimRange) => void;
  onClearTrim: () => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("6");
  const [trimStartIndex, setTrimStartIndex] = useState(0);
  const [trimEndIndex, setTrimEndIndex] = useState(Math.max(0, screenshots.length - 1));
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const [playbackClipId, setPlaybackClipId] = useState<string | undefined>();
  const [playbackOffsetMs, setPlaybackOffsetMs] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voicePlaybackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setIndex(Math.min(initialIndex, Math.max(0, screenshots.length - 1)));
    setPlaying(false);
  }, [initialIndex, screenshots.length]);

  useEffect(() => {
    const initialRange = trimIndexesForScreenshots(screenshots, trim);
    setTrimStartIndex(initialRange.start);
    setTrimEndIndex(initialRange.end);
  }, [screenshots, trim]);

  useEffect(() => {
    if (!playing || screenshots.length <= 1) {
      return;
    }
    const current = screenshots[index] ?? screenshots[0];
    const next = screenshots[(index + 1) % screenshots.length] ?? screenshots[0];
    const timer = window.setTimeout(() => {
      setIndex((value) => (value + 1) % screenshots.length);
    }, replayFrameDelay(current, next, Number.parseFloat(speed) || 1));
    return () => window.clearTimeout(timer);
  }, [index, playing, screenshots, speed]);

  useEffect(() => () => {
    audioRef.current?.pause();
    if (voicePlaybackTimerRef.current) {
      window.clearInterval(voicePlaybackTimerRef.current);
    }
  }, []);

  if (!screenshots.length) {
    return null;
  }

  const currentIndex = Math.min(index, Math.max(0, screenshots.length - 1));
  const current = screenshots[currentIndex] ?? screenshots[0];
  const currentFlags = flags.filter((flag) => flag.targetType === "frame" && flag.targetId === replayFrameTargetId(current));
  const currentAnnotations = annotations.filter((annotation) => annotation.targetId === replayFrameTargetId(current));
  const trimStart = Math.min(trimStartIndex, trimEndIndex);
  const trimEnd = Math.max(trimStartIndex, trimEndIndex);
  const trimmedCount = trimEnd - trimStart + 1;
  const trimActive = trimmedCount < screenshots.length;
  const move = (offset: number) => {
    setIndex((value) => (value + offset + screenshots.length) % screenshots.length);
  };
  const cutBefore = (frameIndex: number) => {
    setTrimStartIndex(frameIndex);
    if (trimEndIndex < frameIndex) {
      setTrimEndIndex(frameIndex);
    }
    setIndex(frameIndex);
    setContextMenu(null);
  };
  const cutAfter = (frameIndex: number) => {
    setTrimEndIndex(frameIndex);
    if (trimStartIndex > frameIndex) {
      setTrimStartIndex(frameIndex);
    }
    setIndex(frameIndex);
    setContextMenu(null);
  };
  const saveTrim = () => {
    const start = screenshots[trimStart];
    const end = screenshots[trimEnd];
    if (!start || !end) {
      return;
    }
    onSaveTrim({
      startCapturedAt: start.capturedAt,
      endCapturedAt: end.capturedAt,
      startFrameKey: replayFrameTargetId(start),
      endFrameKey: replayFrameTargetId(end),
      savedAt: new Date().toISOString()
    });
    setContextMenu(null);
  };
  const clearTrim = () => {
    setTrimStartIndex(0);
    setTrimEndIndex(Math.max(0, screenshots.length - 1));
    setContextMenu(null);
    onClearTrim();
  };
  const openFrameMenu = (event: React.MouseEvent, frameIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    setPlaying(false);
    setIndex(frameIndex);
    setContextMenu({ ...replayContextMenuPosition(event.clientX, event.clientY), index: frameIndex });
  };
  const stopFrameVoicePlayback = () => {
    if (voicePlaybackTimerRef.current) {
      window.clearInterval(voicePlaybackTimerRef.current);
      voicePlaybackTimerRef.current = null;
    }
    setPlaybackClipId(undefined);
    setPlaybackOffsetMs(0);
  };
  const playFrameVoice = (note: ReplayVoiceNote) => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    stopFrameVoicePlayback();
    audioRef.current.pause();
    audioRef.current.src = note.dataUrl;
    audioRef.current.currentTime = 0;
    setPlaybackClipId(note.id);
    setPlaybackOffsetMs(0);
    voicePlaybackTimerRef.current = window.setInterval(() => {
      setPlaybackOffsetMs(Math.round((audioRef.current?.currentTime ?? 0) * 1000));
    }, 80);
    audioRef.current.onended = () => stopFrameVoicePlayback();
    void audioRef.current.play();
  };

  return (
    <div className="modal-backdrop replay-slideshow-backdrop" onClick={onClose} onContextMenu={(event) => event.preventDefault()}>
      <section
        className="replay-slideshow"
        onClick={(event) => {
          event.stopPropagation();
          setContextMenu(null);
        }}
      >
        <header>
          <div>
            <span>Visual replay</span>
            <h2>{title}</h2>
            <p>{players} - frame {currentIndex + 1} of {screenshots.length}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="Close visual replay">
            <X size={18} />
          </button>
        </header>
        <div className="replay-slideshow-stage">
          <button type="button" className="replay-slide-nav" onClick={() => move(-1)} title="Previous frame">
            <ChevronLeft size={26} />
          </button>
          <figure>
            <div className="replay-frame-stage">
              {current.url ? <img src={current.url} alt="" /> : null}
              <ReplayAnnotationCanvas
                annotations={currentAnnotations}
                targetId={replayFrameTargetId(current)}
                targetLabel={current.label}
                capturedAt={current.capturedAt}
                layerId={activeLayerId}
                playbackClipId={playbackClipId}
                playbackOffsetMs={playbackOffsetMs}
                onAddAnnotation={onAddAnnotation}
                onRemoveAnnotation={onRemoveAnnotation}
              />
            </div>
            <figcaption>
              <strong>{current.label}</strong>
              <span>{new Date(current.capturedAt).toLocaleString()}</span>
              {currentFlags.length ? <b>{currentFlags.map((flag) => flag.label).join(", ")}</b> : null}
              <em>{current.source === "timed-replay" ? "Timed visual replay frame" : current.source}</em>
            </figcaption>
          </figure>
          <button type="button" className="replay-slide-nav" onClick={() => move(1)} title="Next frame">
            <ChevronRight size={26} />
          </button>
        </div>
        <div className="replay-player-controls">
          <button type="button" className="secondary" onClick={() => setPlaying((value) => !value)}>
            {playing ? <Pause size={16} /> : <Play size={16} />} {playing ? "Pause" : "Play"}
          </button>
          <button type="button" className="secondary" onClick={() => onFlagFrame(current)}>
            <Flag size={16} /> Flag frame
          </button>
          <label>
            Frame
            <input
              type="range"
              min="0"
              max={Math.max(0, screenshots.length - 1)}
              value={currentIndex}
              onChange={(event) => setIndex(Number.parseInt(event.target.value, 10) || 0)}
            />
          </label>
          <select value={speed} onChange={(event) => setSpeed(event.target.value)} title="Playback speed">
            <option value="0.5">0.5x</option>
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="4">4x</option>
            <option value="6">6x</option>
            <option value="8">8x</option>
          </select>
        </div>
        {currentFlags.length ? (
          <div className="replay-frame-marker-row">
            {currentFlags.map((flag) => {
              const note = replayVoiceNoteForFlag(voiceNotes, flag.id, flag.layerId);
              return (
                <button
                  type="button"
                  key={flag.id}
                  data-has-voice={Boolean(note)}
                  data-flag-type={flag.type ?? replayFlagTypeFromLabel(flag.label)}
                  onClick={() => note ? playFrameVoice(note) : onEditFlag(flag)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onEditFlag(flag);
                  }}
                  title={note ? "Play voice note, right-click to edit" : "Edit flag"}
                >
                  {note ? <Mic size={13} /> : <Flag size={13} />}
                  <span>{replayFlagTypeLabel(flag)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="replay-trim-controls">
          <span>{trimActive ? `Keeping ${trimmedCount} of ${screenshots.length} frames` : `All ${screenshots.length} frames kept`}</span>
          <em>Right-click the timeline to cut before or after a frame.</em>
          <button type="button" className="primary" onClick={saveTrim} disabled={!trimActive && !trim}>
            Save trim
          </button>
          <button type="button" className="secondary" onClick={clearTrim} disabled={!trimActive && !trim}>
            Clear trim
          </button>
        </div>
        <div className="replay-slide-strip">
          {screenshots.map((screenshot, thumbIndex) => {
            const thumbFlags = flags.filter((flag) => flag.targetType === "frame" && flag.targetId === replayFrameTargetId(screenshot));
            const thumbHasVoice = thumbFlags.some((flag) => replayVoiceNoteForFlag(voiceNotes, flag.id, flag.layerId));
            return (
              <button
                type="button"
                key={screenshotKey(screenshot)}
                data-active={thumbIndex === currentIndex}
                data-trim-state={trimMarkerState(thumbIndex, trimStart, trimEnd)}
                data-has-flags={Boolean(thumbFlags.length)}
                data-has-voice={thumbHasVoice}
                onClick={() => setIndex(thumbIndex)}
                onContextMenu={(event) => openFrameMenu(event, thumbIndex)}
                title={thumbFlags.length ? `${screenshot.label} - ${thumbFlags.map(replayFlagTypeLabel).join(", ")}` : screenshot.label}
              >
                {screenshot.url ? <img src={screenshot.url} alt="" loading="lazy" /> : <Camera size={16} />}
                {thumbFlags.length ? <i>{thumbHasVoice ? <Mic size={12} /> : <Flag size={12} />}</i> : null}
                <span>{thumbIndex + 1}</span>
              </button>
            );
          })}
        </div>
        {contextMenu ? (
          <div
            className="replay-frame-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <strong>Frame {contextMenu.index + 1}</strong>
            <button type="button" onClick={() => cutBefore(contextMenu.index)}>Remove everything before this</button>
            <button type="button" onClick={() => cutAfter(contextMenu.index)}>Remove everything after this</button>
            <button type="button" onClick={saveTrim}>Save current trim</button>
            <button type="button" onClick={clearTrim}>Clear trim</button>
            <button
              type="button"
              onClick={() => {
                const frame = screenshots[contextMenu.index];
                const existing = flags.find((flag) => flag.targetType === "frame" && flag.targetId === replayFrameTargetId(frame));
                if (existing) {
                  onEditFlag(existing);
                } else {
                  onFlagFrame(frame);
                }
                setContextMenu(null);
              }}
            >
              {flags.some((flag) => flag.targetType === "frame" && flag.targetId === replayFrameTargetId(screenshots[contextMenu.index])) ? "Edit frame flag" : "Flag this frame"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function trimIndexesForScreenshots(
  screenshots: AtlasReplayViewModel["screenshots"],
  trim?: ReplayTrimRange
): { start: number; end: number } {
  if (!screenshots.length) {
    return { start: 0, end: 0 };
  }
  if (!trim) {
    return { start: 0, end: screenshots.length - 1 };
  }
  const startTime = new Date(trim.startCapturedAt).getTime();
  const endTime = new Date(trim.endCapturedAt).getTime();
  const minTime = Math.min(startTime, endTime);
  const maxTime = Math.max(startTime, endTime);
  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) {
    return { start: 0, end: screenshots.length - 1 };
  }
  const start = screenshots.findIndex((screenshot) => new Date(screenshot.capturedAt).getTime() >= minTime);
  const end = findLastScreenshotIndexAtOrBefore(screenshots, maxTime);
  return {
    start: start >= 0 ? start : 0,
    end: end >= 0 ? end : screenshots.length - 1
  };
}

function findLastScreenshotIndexAtOrBefore(screenshots: AtlasReplayViewModel["screenshots"], time: number): number {
  for (let index = screenshots.length - 1; index >= 0; index -= 1) {
    const capturedAt = new Date(screenshots[index].capturedAt).getTime();
    if (Number.isFinite(capturedAt) && capturedAt <= time) {
      return index;
    }
  }
  return -1;
}

function trimMarkerState(index: number, start: number, end: number): "start" | "end" | "inside" | "outside" {
  if (index === start) return "start";
  if (index === end) return "end";
  if (index > start && index < end) return "inside";
  return "outside";
}

function replayContextMenuPosition(x: number, y: number): { x: number; y: number } {
  const menuWidth = 236;
  const menuHeight = 240;
  const padding = 10;
  return {
    x: Math.min(Math.max(padding, x), Math.max(padding, window.innerWidth - menuWidth - padding)),
    y: Math.min(Math.max(padding, y), Math.max(padding, window.innerHeight - menuHeight - padding))
  };
}

function replayFrameDelay(
  current: AtlasReplayViewModel["screenshots"][number],
  next: AtlasReplayViewModel["screenshots"][number],
  speed: number
): number {
  const currentAt = new Date(current.capturedAt).getTime();
  const nextAt = new Date(next.capturedAt).getTime();
  const raw = Number.isFinite(currentAt) && Number.isFinite(nextAt) && nextAt > currentAt
    ? nextAt - currentAt
    : 1800;
  return Math.round(Math.min(4500, Math.max(800, raw)) / Math.max(0.25, speed));
}

function ReplayBattlefields({ model }: { model: AtlasReplayViewModel }) {
  if (!model.battlefields.length) {
    return null;
  }
  return (
    <section className="rail-card replay-battlefields">
      <h2>Battlefields</h2>
      <div className="replay-battlefield-grid">
        {model.battlefields.map((battlefield, index) => (
          <div className="replay-battlefield-card" data-side={battlefield.side} key={`${battlefield.side}:${battlefield.name}:${battlefield.code}:${index}`}>
            {battlefield.image ? <img src={battlefield.image} alt="" loading="lazy" /> : <span>{battlefield.name || battlefield.code || "BF"}</span>}
            <div>
              <strong>{battlefield.name || battlefield.code || "Unknown battlefield"}</strong>
              <em>{battlefield.side === "me" ? "Player" : battlefield.side === "opponent" ? "Opponent" : "Board"}</em>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReplayEventFeed({ events }: { events: ReplayTimelineEvent[] }) {
  return (
    <div className="replay-event-feed">
      {events.map((event) => (
        <div className="replay-event-row" data-event-type={event.type} data-side={event.side} key={event.id}>
          <span>{event.labelTime}</span>
          <strong>{event.type.replace("-", " ")}</strong>
          <p>{event.text}</p>
          {event.score ? <em>{event.score.me ?? "-"}-{event.score.opponent ?? "-"}</em> : null}
        </div>
      ))}
      {!events.length ? <p className="muted">No events in this slice.</p> : null}
    </div>
  );
}

function ReplayCards({ cards }: { cards: ReplayTurnView["cards"] }) {
  return (
    <section className="replay-mini-panel">
      <h3>Cards</h3>
      {cards.map((card) => (
        <div className="browser-row" key={`${card.name}:${card.destination}:${card.side}`}>
          <strong>{card.name}</strong>
          <span>{card.destination || card.side}</span>
        </div>
      ))}
      {!cards.length ? <p className="muted">No card actions found.</p> : null}
    </section>
  );
}

function ReplayPointEvents({ events }: { events: ReplayTimelineEvent[] }) {
  return (
    <section className="replay-mini-panel">
      <h3>Scoring</h3>
      {events.map((event) => (
        <div className="browser-row" key={`${event.id}:point`}>
          <strong>{event.pointsScored ? `+${event.pointsScored}` : event.type}</strong>
          <span>{event.battlefield || event.text}</span>
        </div>
      ))}
      {!events.length ? <p className="muted">No scoring in this turn.</p> : null}
    </section>
  );
}

function SettingsView({
  settings,
  browsers,
  diagnosticsPath,
  diagnosticsSummary,
  diagnosticsBundlePath,
  updateStatus,
  screenshotStatus,
  deletedMatches,
  deletedReplays,
  importSummary,
  onSave,
  onImportLegacy,
  onTakeScreenshot,
  onChooseScreenshotDirectory,
  onOpenScreenshotDirectory,
  onRefreshDiagnostics,
  onCreateDiagnosticsBundle,
  onCheckUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onRestoreDeletedMatch,
  onPurgeDeletedMatch,
  onRestoreDeletedReplay,
  onPurgeDeletedReplay
}: {
  settings: UserSettings;
  browsers: BrowserInfo[];
  diagnosticsPath: string;
  diagnosticsSummary: CaptureDiagnosticsSummary | null;
  diagnosticsBundlePath: string;
  updateStatus: UpdateStatus;
  screenshotStatus: string;
  deletedMatches: MatchDraft[];
  deletedReplays: ReplayRecord[];
  importSummary: ImportSummary | null;
  onSave: (patch: Partial<UserSettings>) => Promise<void>;
  onImportLegacy: () => Promise<void>;
  onTakeScreenshot: () => Promise<void>;
  onChooseScreenshotDirectory: () => Promise<void>;
  onOpenScreenshotDirectory: () => Promise<void>;
  onRefreshDiagnostics: () => Promise<void>;
  onCreateDiagnosticsBundle: () => Promise<void>;
  onCheckUpdates: () => Promise<void>;
  onDownloadUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onRestoreDeletedMatch: (id: string) => Promise<void>;
  onPurgeDeletedMatch: (id: string) => Promise<void>;
  onRestoreDeletedReplay: (id: string) => Promise<void>;
  onPurgeDeletedReplay: (id: string) => Promise<void>;
}) {
  const [showAdvancedDiagnostics, setShowAdvancedDiagnostics] = useState(false);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioStatus, setAudioStatus] = useState("");
  async function refreshAudioInputs(requestPermission = false) {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioStatus("Microphone device listing is not available on this system.");
      return;
    }
    let permissionStream: MediaStream | null = null;
    try {
      if (requestPermission) {
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(devices.filter((device) => device.kind === "audioinput"));
      setAudioStatus(requestPermission ? "Microphones refreshed." : "");
    } catch (error) {
      setAudioStatus(error instanceof Error ? error.message : "Microphone access was blocked.");
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
    }
  }
  useEffect(() => {
    void refreshAudioInputs(false);
  }, []);
  return (
    <section className="dashboard-page settings-page">
      <div className="settings-grid">
        <div className="rail-card">
          <h2>Profile</h2>
          <label>Username<input value={settings.username} onChange={(event) => void onSave({ username: event.target.value })} /></label>
          <SyncModeControl settings={settings} onSave={onSave} />
          <label className="toggle-row">
            <span><Bell size={16} /> Confirm matches</span>
            <input
              type="checkbox"
              checked={settings.confirmationEnabled}
              onChange={(event) => void onSave({ confirmationEnabled: event.target.checked })}
            />
          </label>
        </div>
        <div className="rail-card">
          <h2>Replays</h2>
          <p className="muted">Visual frames stay lightweight. Video replay is optional and attaches shareable video to the .riftreplay teaching bundle.</p>
          <label className="toggle-row">
            <span><History size={16} /> Replay capture</span>
            <input
              type="checkbox"
              checked={settings.replayCaptureEnabled}
              onChange={(event) => void onSave({ replayCaptureEnabled: event.target.checked })}
            />
          </label>
          <label className="toggle-row">
            <span><Camera size={16} /> Timed visual frames</span>
            <input
              type="checkbox"
              checked={settings.replayKeyframesEnabled}
              onChange={(event) => void onSave({ replayKeyframesEnabled: event.target.checked })}
            />
          </label>
          <label>
            Visual frame detail
            <select
              value={settings.replayFramePreset}
              disabled={!settings.replayCaptureEnabled || !settings.replayKeyframesEnabled || settings.replayVideoEnabled}
              onChange={(event) => void onSave({ replayFramePreset: event.target.value as ReplayFramePreset })}
            >
              {Object.entries(REPLAY_FRAME_PRESETS).map(([value, preset]) => (
                <option value={value} key={value}>{preset.label} - {preset.interval} - {preset.note}</option>
              ))}
            </select>
          </label>
          <label className="toggle-row">
            <span><Video size={16} /> Video Replay Beta</span>
            <input
              type="checkbox"
              checked={settings.replayVideoEnabled}
              onChange={(event) => void onSave({ replayVideoEnabled: event.target.checked })}
            />
          </label>
          <label>
            Video capture source
            <select
              value={settings.replayVideoMode || "game-frame"}
              disabled={!settings.replayVideoEnabled}
              onChange={(event) => void onSave({ replayVideoMode: event.target.value as ReplayVideoCaptureMode })}
            >
              <option value="game-frame">Direct game frame - recommended</option>
              <option value="system-window">System window crop - fallback</option>
            </select>
          </label>
          <label>
            Video quality
            <select
              value={settings.replayVideoQuality}
              disabled={!settings.replayVideoEnabled}
              onChange={(event) => void onSave({ replayVideoQuality: event.target.value as ReplayVideoQuality })}
            >
              {Object.entries(REPLAY_VIDEO_PROFILES).map(([value, profile]) => (
                <option value={value} key={value}>{profile.label} - target {profile.bitrateKbps} kbps</option>
              ))}
            </select>
          </label>
          <p className="muted">Direct game frame records only the embedded TCGA/Atlas view and avoids per-frame capture work. Click anywhere in the Play screen before queueing so Windows can arm the stream; window crop stays available as the controlled fallback.</p>
        </div>
        <div className="rail-card">
          <h2>Voice notes</h2>
          <p className="muted">Voice notes are optional coaching clips. RiftLite only asks for microphone access when you press record or refresh devices, and exported .riftreplay files include any voice notes you choose to save.</p>
          <label>
            Microphone
            <select
              value={settings.microphoneDeviceId}
              onChange={(event) => void onSave({ microphoneDeviceId: event.target.value })}
            >
              <option value="">System default microphone</option>
              {audioInputs.map((device, index) => (
                <option value={device.deviceId} key={device.deviceId || index}>
                  {device.label || `Microphone ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <div className="row-actions">
            <button type="button" className="secondary" onClick={() => void refreshAudioInputs(true)}>
              <Mic size={14} /> Refresh microphones
            </button>
          </div>
          {audioStatus ? <p className="muted">{audioStatus}</p> : null}
        </div>
        <div className="rail-card">
          <h2>Browser support</h2>
          {browsers.map((browser) => (
            <div className="browser-row" key={browser.name}>
              <strong>{browser.name}</strong>
              <span>{browser.installed ? "Detected" : "Not detected"}</span>
            </div>
          ))}
        </div>
        <div className="rail-card">
          <h2>Upgrade import</h2>
          <p className="muted">RiftLite imports the old desktop database automatically from your Windows profile.</p>
          {importSummary ? (
            <>
              <StatRow label="Imported matches" value={String(importSummary.importedMatches)} />
              <StatRow label="Imported hubs" value={String(importSummary.importedHubs)} />
            </>
          ) : (
            <StatRow label="Status" value="Auto-import checked at startup" />
          )}
          <button className="secondary" onClick={() => void onImportLegacy()}>Run import again</button>
        </div>
        <ScreenshotToolkitPanel
          settings={settings}
          screenshotStatus={screenshotStatus}
          onSave={onSave}
          onTakeScreenshot={onTakeScreenshot}
          onChooseScreenshotDirectory={onChooseScreenshotDirectory}
          onOpenScreenshotDirectory={onOpenScreenshotDirectory}
        />
        <RecycleBinPanel
          matches={deletedMatches}
          replays={deletedReplays}
          onRestoreMatch={onRestoreDeletedMatch}
          onPurgeMatch={onPurgeDeletedMatch}
          onRestoreReplay={onRestoreDeletedReplay}
          onPurgeReplay={onPurgeDeletedReplay}
        />
        <LegalNoticePanel />
        <div className="rail-card">
          <h2>Diagnostics</h2>
          <p className="muted">Advanced capture tools are tucked away for tester reports and support.</p>
          <label className="toggle-row">
            <span><Activity size={16} /> Debug capture</span>
            <input
              type="checkbox"
              checked={settings.debugMode}
              onChange={(event) => void onSave({ debugMode: event.target.checked })}
            />
          </label>
          <input readOnly value={diagnosticsPath} />
          <div className="row-actions">
            <button className="secondary" onClick={() => void window.riftlite.openDiagnosticsFolder()}>
              <FolderOpen size={16} /> Logs
            </button>
            <button className="primary" onClick={() => setShowAdvancedDiagnostics((open) => !open)}>
              {showAdvancedDiagnostics ? "Hide advanced" : "Show advanced"}
            </button>
          </div>
        </div>
        <div className="rail-card">
          <h2>Updates</h2>
          <p className="muted">{updateStatus.message}</p>
          <StatRow label="Current" value={updateStatus.currentVersion} />
          {updateStatus.latestVersion ? <StatRow label="Latest" value={updateStatus.latestVersion} /> : null}
          {typeof updateStatus.progress === "number" ? <StatRow label="Download" value={`${updateStatus.progress}%`} /> : null}
          <div className="row-actions">
            <button className="secondary" onClick={() => void onCheckUpdates()}>Check</button>
            <button className="primary" onClick={() => void onDownloadUpdate()} disabled={updateStatus.state !== "available"}>Download</button>
            <button className="secondary" onClick={() => void onInstallUpdate()} disabled={updateStatus.state !== "downloaded"}>Install</button>
          </div>
        </div>
      </div>
      {showAdvancedDiagnostics ? (
        <CaptureLabView
          embedded
          summary={diagnosticsSummary}
          bundlePath={diagnosticsBundlePath}
          settings={settings}
          onSave={onSave}
          onRefresh={onRefreshDiagnostics}
          onBundle={onCreateDiagnosticsBundle}
          onOpenFolder={() => window.riftlite.openDiagnosticsFolder()}
        />
      ) : null}
    </section>
  );
}

function LegalNoticePanel() {
  return (
    <div className="rail-card legal-notice-card">
      <h2>Legal and data</h2>
      <p>{RIOT_LEGAL_NOTICE}</p>
      <p className="muted">
        Community views use user-submitted match records. RiftLite does not provide skill-based matchmaking, MMR, automated rules enforcement, or a public player leaderboard.
      </p>
    </div>
  );
}

function ScreenshotToolkitPanel({
  settings,
  screenshotStatus,
  onSave,
  onTakeScreenshot,
  onChooseScreenshotDirectory,
  onOpenScreenshotDirectory
}: {
  settings: UserSettings;
  screenshotStatus: string;
  onSave: (patch: Partial<UserSettings>) => Promise<void>;
  onTakeScreenshot: () => Promise<void>;
  onChooseScreenshotDirectory: () => Promise<void>;
  onOpenScreenshotDirectory: () => Promise<void>;
}) {
  const [hotkeyDraft, setHotkeyDraft] = useState(settings.screenshotHotkey || "F9");
  useEffect(() => {
    setHotkeyDraft(settings.screenshotHotkey || "F9");
  }, [settings.screenshotHotkey]);
  const screenshotPath = settings.screenshotDirectory || "Default: Pictures\\RiftLite";

  function commitHotkey() {
    const next = hotkeyDraft.trim() || "F9";
    setHotkeyDraft(next);
    void onSave({ screenshotHotkey: next });
  }

  return (
    <div className="rail-card toolkit-card">
      <h2>Toolkit</h2>
      <p className="muted">Screenshots are for reviewing board states after a match without crowding the play window.</p>
      <label>Screenshot folder<input readOnly value={screenshotPath} /></label>
      <div className="row-actions">
        <button className="primary" onClick={() => void onTakeScreenshot()}><Camera size={16} /> Screenshot</button>
        <button className="secondary" onClick={() => void onChooseScreenshotDirectory()}><FolderOpen size={16} /> Choose</button>
        <button className="secondary" onClick={() => void onOpenScreenshotDirectory()}>Open folder</button>
      </div>
      {screenshotStatus ? <p className="muted">{screenshotStatus}</p> : null}
      <label className="toggle-row">
        <span><Keyboard size={16} /> Global screenshot hotkey</span>
        <input
          type="checkbox"
          checked={settings.screenshotHotkeyEnabled}
          onChange={(event) => void onSave({ screenshotHotkeyEnabled: event.target.checked })}
        />
      </label>
      <label>Hotkey<input value={hotkeyDraft} onChange={(event) => setHotkeyDraft(event.target.value)} onBlur={commitHotkey} onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }} placeholder="F9 or CommandOrControl+Shift+S" /></label>
      <details className="resource-menu">
        <summary>Community resources</summary>
        <div className="resource-grid">
          {TOOLKIT_RESOURCES.map((resource) => {
            const Icon = resource.icon;
            return (
              <button className="resource-link" key={resource.id} onClick={() => void window.riftlite.openExternalResource(resource.url)}>
                <Icon size={17} />
                <span>
                  <strong>{resource.label}</strong>
                  <em>{resource.description}</em>
                </span>
                <ExternalLink size={14} />
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}

function RecycleBinPanel({
  matches,
  replays,
  onRestoreMatch,
  onPurgeMatch,
  onRestoreReplay,
  onPurgeReplay
}: {
  matches: MatchDraft[];
  replays: ReplayRecord[];
  onRestoreMatch: (id: string) => Promise<void>;
  onPurgeMatch: (id: string) => Promise<void>;
  onRestoreReplay: (id: string) => Promise<void>;
  onPurgeReplay: (id: string) => Promise<void>;
}) {
  const latestMatches = matches.slice(0, 6);
  const latestReplays = replays.slice(0, 6);
  return (
    <div className="rail-card recycle-bin-card">
      <h2>Recycle bin</h2>
      <p className="muted">Deleted matches and replays are kept here first, so mistakes are recoverable.</p>
      <div className="recycle-section">
        <strong>Matches</strong>
        {latestMatches.map((match) => (
          <div className="recycle-row" key={match.id}>
            <span>{normalizeLegendName(match.myChampion) || "Unknown"} vs {normalizeLegendName(match.opponentChampion) || "Unknown"} - {new Date(match.capturedAt).toLocaleDateString()}</span>
            <div className="row-actions">
              <button className="secondary" onClick={() => void onRestoreMatch(match.id)}>Restore</button>
              <button className="secondary danger" onClick={() => void onPurgeMatch(match.id)}>Delete forever</button>
            </div>
          </div>
        ))}
        {!latestMatches.length ? <span className="muted">No deleted matches.</span> : null}
      </div>
      <div className="recycle-section">
        <strong>Replays</strong>
        {latestReplays.map((replay) => (
          <div className="recycle-row" key={replay.id}>
            <span>{replay.title || replay.id} - {new Date(replay.capturedAt).toLocaleDateString()}</span>
            <div className="row-actions">
              <button className="secondary" onClick={() => void onRestoreReplay(replay.id)}>Restore</button>
              <button className="secondary danger" onClick={() => void onPurgeReplay(replay.id)}>Delete forever</button>
            </div>
          </div>
        ))}
        {!latestReplays.length ? <span className="muted">No deleted replays.</span> : null}
      </div>
    </div>
  );
}

function HubsView({ settings, matches, hubMatches, onSave, onHubResult, onSyncPrivateHubs, onSyncMatchesToHubs, onDeleteHubMatch, onRefresh }: {
  settings: UserSettings;
  matches: MatchDraft[];
  hubMatches: Record<string, CommunityMatch[]>;
  onSave: (patch: Partial<UserSettings>) => Promise<void>;
  onHubResult: (result: HubActionResult) => Promise<void>;
  onSyncPrivateHubs: () => Promise<PrivateHubSyncResult>;
  onSyncMatchesToHubs: (matchIds: string[], hubIds: string[]) => Promise<PrivateHubSyncResult>;
  onDeleteHubMatch: (hubId: string, matchId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"create" | "join">("join");
  const [message, setMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const [selectedHubId, setSelectedHubId] = useState("");
  const [targetHubId, setTargetHubId] = useState("");
  const [selectedMatchIds, setSelectedMatchIds] = useState<string[]>([]);
  const filteredHubs = useMemo(
    () => selectedHubId ? settings.activeHubs.filter((hub) => hub.id === selectedHubId) : settings.activeHubs,
    [selectedHubId, settings.activeHubs]
  );
  const hubAnalytics = useMemo(
    () => validAnalytics(filteredHubs.flatMap((hub) => (hubMatches[hub.id] ?? []).map((match) => communityToAnalytics(match)))),
    [filteredHubs, hubMatches]
  );
  const hubFeedRows = useMemo(
    () => filteredHubs.flatMap((hub) => (hubMatches[hub.id] ?? []).slice(0, 12).map((match) => ({ hub, match }))),
    [filteredHubs, hubMatches]
  );
  const savedMatchCount = useMemo(() => matches.filter((match) => match.status === "saved" && match.result !== "Incomplete").length, [matches]);
  const enabledHubCount = useMemo(() => settings.activeHubs.filter((hub) => hub.sync).length, [settings.activeHubs]);
  const syncableMatches = useMemo(() => matches.filter((match) => match.status === "saved" && match.result !== "Incomplete").slice(0, 80), [matches]);

  useEffect(() => {
    const firstEnabled = settings.activeHubs.find((hub) => hub.sync)?.id || settings.activeHubs[0]?.id || "";
    setTargetHubId((current) => current && settings.activeHubs.some((hub) => hub.id === current) ? current : firstEnabled);
    setSelectedHubId((current) => current && settings.activeHubs.some((hub) => hub.id === current) ? current : "");
  }, [settings.activeHubs]);

  async function submitHub() {
    const clean = name.trim();
    if (!clean || !password) {
      setMessage("Hub name and password are required.");
      return;
    }
    setMessage("Working...");
    try {
      const result = mode === "create" ? await window.riftlite.createHub(clean, password) : await window.riftlite.joinHub(clean, password);
      await onHubResult(result);
      setName("");
      setPassword("");
      setMessage(`${mode === "create" ? "Created" : "Joined"} ${result.hub.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Hub action failed.");
    }
  }

  async function manualPrivateSync() {
    setSyncStatus("Syncing saved matches to private hubs...");
    try {
      const result = await onSyncPrivateHubs();
      setSyncStatus(result.message);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Private hub sync failed.");
    }
  }

  async function syncSelectedMatches() {
    const hubId = targetHubId || settings.activeHubs.find((hub) => hub.sync)?.id || "";
    if (!hubId || !selectedMatchIds.length) {
      setSyncStatus("Choose at least one match and one enabled hub.");
      return;
    }
    setSyncStatus("Syncing selected matches to private hub...");
    try {
      const result = await onSyncMatchesToHubs(selectedMatchIds, [hubId]);
      setSelectedMatchIds([]);
      setSyncStatus(result.message);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Selected hub sync failed.");
    }
  }

  async function deleteRemoteHubMatch(hubId: string, matchId: string) {
    setSyncStatus("Removing match from private hub...");
    try {
      await onDeleteHubMatch(hubId, matchId);
      setSyncStatus("Removed match from private hub only. Community data was not touched.");
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : "Hub match delete failed.");
    }
  }

  function toggleSelectedMatch(id: string, checked: boolean) {
    setSelectedMatchIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id));
  }

  return (
    <section className="dashboard-page two-column">
      <div className="rail-card">
        <h2>Privacy sync</h2>
        <SyncModeControl settings={settings} onSave={onSave} />
        <div className="drilldown-grid hub-sync-metrics">
          <Metric label="Saved matches" value={String(savedMatchCount)} />
          <Metric label="Enabled hubs" value={String(enabledHubCount)} />
        </div>
        <button
          className="primary"
          disabled={!savedMatchCount || !enabledHubCount}
          onClick={() => void manualPrivateSync()}
        >
          Sync saved matches to private hubs
        </button>
        <p className="muted">
          Manual private sync disables public community upload for those matches and sends them only to enabled hubs.
        </p>
        {syncStatus ? <p className="muted">{syncStatus}</p> : null}
      </div>
      <div className="rail-card hub-bulk-card">
        <h2>Send matches to a hub</h2>
        <label>Target hub<select value={targetHubId} onChange={(event) => setTargetHubId(event.target.value)}>
          {settings.activeHubs.map((hub) => <option value={hub.id} key={hub.id}>{hub.name}{hub.sync ? "" : " (disabled)"}</option>)}
        </select></label>
        <div className="hub-match-picker">
          {syncableMatches.map((match) => (
            <label className="toggle-row" key={match.id}>
              <span>{normalizeLegendName(match.myChampion) || "Unknown"} vs {normalizeLegendName(match.opponentChampion) || "Unknown"} - {displayMatchRecord(match) || match.result}</span>
              <input
                type="checkbox"
                checked={selectedMatchIds.includes(match.id)}
                onChange={(event) => toggleSelectedMatch(match.id, event.target.checked)}
              />
            </label>
          ))}
          {!syncableMatches.length ? <p className="muted">No saved completed matches are ready to sync.</p> : null}
        </div>
        <button className="primary" disabled={!selectedMatchIds.length || !targetHubId} onClick={() => void syncSelectedMatches()}>
          Sync {selectedMatchIds.length || "selected"} to hub
        </button>
      </div>
      <div className="rail-card">
        <h2>Joined hubs</h2>
        <label>View hub<select value={selectedHubId} onChange={(event) => setSelectedHubId(event.target.value)}>
          <option value="">All hubs</option>
          {settings.activeHubs.map((hub) => <option value={hub.id} key={hub.id}>{hub.name}</option>)}
        </select></label>
        {settings.activeHubs.map((hub) => (
          <div key={hub.id}>
            <label className="toggle-row">
              <span>{hub.name}</span>
              <input
                type="checkbox"
                checked={hub.sync}
                onChange={(event) => void onSave({ activeHubs: settings.activeHubs.map((item) => item.id === hub.id ? { ...item, sync: event.target.checked } : item) })}
              />
            </label>
            <span className="muted">{hubMatches[hub.id]?.length ?? 0} synced hub matches</span>
          </div>
        ))}
        {!settings.activeHubs.length ? <p className="muted">No private hubs joined yet.</p> : null}
        <button className="secondary" onClick={() => void onRefresh()}>Refresh hub data</button>
      </div>
      <div className="rail-card">
        <h2>Private hub access</h2>
        <div className="top-actions hub-mode">
          <button className="segmented" data-active={mode === "join"} onClick={() => setMode("join")}>Join</button>
          <button className="segmented" data-active={mode === "create"} onClick={() => setMode("create")}>Create</button>
        </div>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Hub name" />
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Hub password" />
        <button
          className="primary"
          onClick={() => void submitHub()}
        >{mode === "create" ? "Create hub" : "Join hub"}</button>
        {message ? <p className="muted">{message}</p> : null}
        <p className="muted">Hub names are unlisted. Users need the exact name and password to sync to the same hub.</p>
      </div>
      <div className="rail-card">
        <h2>Hub feed</h2>
        {hubFeedRows.map(({ hub, match }) => (
          <div className="event-row" key={`${hub.id}:${match.id}`}>
            <span>{hub.name}: {match.myChampion || "Unknown"} vs {match.opponentChampion || "unknown"}</span>
            <div className="row-actions">
              <strong>{match.result}</strong>
              <button className="secondary danger" onClick={() => void deleteRemoteHubMatch(hub.id, match.id)}>Remove from hub</button>
            </div>
          </div>
        ))}
        {!hubFeedRows.length ? <p className="muted">Private hub matches will appear here after sync.</p> : null}
      </div>
      <section className="wide-panel">
        <HubStatsPanel matches={hubAnalytics} />
      </section>
    </section>
  );
}

function CommunityView({ matches, communityMatches, hubMatches, settings, status, onRefresh }: {
  matches: MatchDraft[];
  communityMatches: CommunityMatch[];
  hubMatches: Record<string, CommunityMatch[]>;
  settings: UserSettings;
  status: string;
  onRefresh: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<CommunityTab>("legend-meta");
  const [formatFilter, setFormatFilter] = useState("");
  const communityRef = useRef<HTMLElement | null>(null);
  const localReady = useMemo(() => matches.filter((match) => match.sync.community === "synced" || match.sync.community === "pending"), [matches]);
  const analytics = useMemo(
    () => validAnalytics(communityMatches.length ? communityMatches.map((match) => communityToAnalytics(match)) : localReady.map(localToAnalytics)),
    [communityMatches, localReady]
  );
  const filteredAnalytics = useMemo(() => filterAnalyticsByFormat(analytics, formatFilter), [analytics, formatFilter]);
  const tabs: Array<{ id: CommunityTab; label: string }> = [
    { id: "legend-meta", label: "Legend Meta" },
    { id: "match-matrix", label: "Match Matrix" },
    { id: "recent-matches", label: "Recent Matches" }
  ];

  function chooseTab(tab: CommunityTab) {
    setActiveTab(tab);
    requestAnimationFrame(() => {
      communityRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  return (
    <section ref={communityRef} className={`dashboard-page community-dashboard ${activeTab === "match-matrix" ? "matrix-focus" : ""}`}>
      <div className="community-toolbar">
        <div>
          <h2>Community submitted matches</h2>
          <span>{status}. User-submitted records only; no public leaderboard or meta alerts.</span>
        </div>
        <div className="community-toolbar-actions">
          <label>Format<select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)}>
            <option value="">All formats</option>
            <option value="Bo1">Bo1</option>
            <option value="Bo3">Bo3</option>
          </select></label>
          <button className="secondary" onClick={() => void onRefresh()}>Refresh</button>
        </div>
      </div>
      <nav className="community-tabs" aria-label="Community sections">
        {tabs.map((tab) => (
          <button className="community-tab" data-active={activeTab === tab.id} key={tab.id} onClick={() => chooseTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>
      {activeTab === "legend-meta" ? <LegendMetaPanel matches={filteredAnalytics} expanded showFlags={false} /> : null}
      {activeTab === "match-matrix" ? <MatchupMatrixPanel matches={filteredAnalytics} emptyText="Community match data will appear here after Firebase sync returns rows." showFlags={false} /> : null}
      {activeTab === "recent-matches" ? <RecentMatchesPanel matches={filteredAnalytics} showFlags={false} /> : null}
    </section>
  );
}

function HubStatsPanel({ matches }: { matches: AnalyticsMatch[] }) {
  const [formatFilter, setFormatFilter] = useState("");
  const filteredMatches = useMemo(() => filterAnalyticsByFormat(matches, formatFilter), [matches, formatFilter]);
  return (
    <section className="hub-stats-panel">
      <div className="panel-header compact-header">
        <div>
          <h2>Private hub stats</h2>
          <span>{filteredMatches.length} of {matches.length} hub match{matches.length === 1 ? "" : "es"} in this shared view</span>
        </div>
        <label className="compact-select-label">Format<select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)}>
          <option value="">All formats</option>
          <option value="Bo1">Bo1</option>
          <option value="Bo3">Bo3</option>
        </select></label>
      </div>
      <LeaderboardPanel matches={filteredMatches} showFlags={false} />
      <LegendMetaPanel matches={filteredMatches} expanded showFlags={false} />
      <MatchupMatrixPanel matches={filteredMatches} emptyText="Private hub match data appears here after joined hubs sync." showFlags={false} />
    </section>
  );
}

function LeaderboardPanel({ matches, showFlags = false }: { matches: AnalyticsMatch[]; showFlags?: boolean }) {
  const [filters, setFilters] = useState<LeaderboardFilters>(DEFAULT_LEADERBOARD_FILTERS);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const legends = useMemo(() => matrixLegendOptions(matches), [matches]);
  const filteredMatches = useMemo(() => filterLeaderboardMatches(matches, filters), [matches, filters]);
  const minGames = Number.parseInt(filters.minGames, 10) || 0;
  const rows = useMemo(
    () => sortLeaderboardRows(leaderboardRows(filteredMatches).filter((row) => row.games >= minGames), filters.sort),
    [filteredMatches, filters.sort, minGames]
  );
  const selectedMatches = useMemo(
    () => selectedPlayer ? filteredMatches.filter((match) => (match.myName || "You") === selectedPlayer) : [],
    [filteredMatches, selectedPlayer]
  );

  function setFilter(key: keyof LeaderboardFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: key === "sort" ? value as LeaderboardSort : value }));
  }

  function choosePlayer(player: string) {
    setSelectedPlayer((current) => current === player ? "" : player);
  }

  return (
    <section className="rail-card leaderboard-card">
      <div className="leaderboard-summary">
        <div>
          <h2>Leaderboard</h2>
          <span>Ranked by Wilson confidence score by default.</span>
        </div>
        <strong>{rows.length} player{rows.length === 1 ? "" : "s"}</strong>
      </div>
      <div className="leaderboard-filters">
        <label>Search<input value={filters.search} onChange={(event) => setFilter("search", event.target.value)} placeholder="Player, legend, opponent..." /></label>
        <label>Legend<select value={filters.legend} onChange={(event) => setFilter("legend", event.target.value)}>
          <option value="">All legends</option>
          {legends.map((legend) => <option value={legend} key={legend}>{legend}</option>)}
        </select></label>
        <label>Format<select value={filters.format} onChange={(event) => setFilter("format", event.target.value)}>
          <option value="">All formats</option>
          <option value="Bo1">Bo1</option>
          <option value="Bo3">Bo3</option>
        </select></label>
        <label>Date<select value={filters.range} onChange={(event) => setFilter("range", event.target.value)}>
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select></label>
        <label>Min games<input type="number" min="0" step="1" value={filters.minGames} onChange={(event) => setFilter("minGames", event.target.value)} /></label>
        <label>Sort<select value={filters.sort} onChange={(event) => setFilter("sort", event.target.value)}>
          <option value="score">Wilson score</option>
          <option value="winRate">Win %</option>
          <option value="games">Games</option>
          <option value="wins">Wins</option>
          <option value="name">Player</option>
        </select></label>
      </div>
      <div className="leaderboard-scroll">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Games</th>
              <th>Win %</th>
              <th>Score</th>
              <th>W / L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                className="clickable-table-row"
                data-active={selectedPlayer === row.name}
                key={row.name}
                tabIndex={0}
                onClick={() => choosePlayer(row.name)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choosePlayer(row.name);
                  }
                }}
              >
                <td>#{index + 1}</td>
                <td>{row.name}</td>
                <td>{row.games}</td>
                <td>{row.winRate.toFixed(1)}%</td>
                <td>{row.score.toFixed(1)}%</td>
                <td>{row.wins} / {row.losses}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <p className="empty-state">Community synced matches will appear here.</p> : null}
      </div>
      {selectedPlayer && selectedMatches.length ? (
        <StatsDrilldown
          title={`${selectedPlayer} stats`}
          subtitle="Community matches for this player in the current filters."
          matches={selectedMatches}
          showFlags={showFlags}
          onClose={() => setSelectedPlayer("")}
        />
      ) : null}
    </section>
  );
}

function AnalyticsSuite({
  title,
  matches,
  filteredMatches,
  filters,
  emptyText,
  showFlags = true,
  onFilterChange,
  onResetFilters
}: {
  title: string;
  matches: AnalyticsMatch[];
  filteredMatches: AnalyticsMatch[];
  filters: MatrixFilters;
  emptyText: string;
  showFlags?: boolean;
  onFilterChange: (key: keyof MatrixFilters, value: string) => void;
  onResetFilters: () => void;
}) {
  const [selectedDrilldown, setSelectedDrilldown] = useState<StatsDrilldownSelection | null>(null);
  const flags = topValueList(filteredMatches.flatMap((match) => splitFlags(match.flags)));
  return (
    <section className="analytics-suite">
      <div className="panel-header compact-header">
        <div>
          <h2>{title}</h2>
          <span>{filteredMatches.length} of {matches.length} match{matches.length === 1 ? "" : "es"} in this view</span>
        </div>
      </div>
      <MatchupMatrixPanel
        matches={matches}
        filteredMatches={filteredMatches}
        filters={filters}
        emptyText={emptyText}
        showFlags={showFlags}
        onFilterChange={onFilterChange}
        onResetFilters={onResetFilters}
      />
      <section className="two-column analytics-side-grid">
        <LegendMetaPanel matches={filteredMatches} showFlags={showFlags} />
        <RecentMatchesPanel matches={filteredMatches} showFlags={showFlags} />
      </section>
      {showFlags ? <section className="rail-card">
        <h2>Flags</h2>
        {flags.map(([flag, count]) => (
          <StatRow
            key={flag}
            label={flag}
            value={String(count)}
            onClick={() => setSelectedDrilldown({
              title: `${flag} matches`,
              subtitle: "Matches tagged with this flag.",
              matches: filteredMatches.filter((match) => splitFlags(match.flags).includes(flag)),
              showFlags
            })}
          />
        ))}
        {!flags.length ? <p className="muted">Flags added during match review will appear here.</p> : null}
      </section> : null}
      {selectedDrilldown ? <StatsDrilldown {...selectedDrilldown} onClose={() => setSelectedDrilldown(null)} /> : null}
    </section>
  );
}

function LegendMetaPanel({ matches, expanded = false, showFlags = true }: { matches: AnalyticsMatch[]; expanded?: boolean; showFlags?: boolean }) {
  const [selectedLegend, setSelectedLegend] = useState("");
  const rows = useMemo(() => legendRows(matches), [matches]);
  const selectedMatches = useMemo(
    () => selectedLegend ? matches.filter((match) => match.myChampion === selectedLegend) : [],
    [matches, selectedLegend]
  );
  return (
    <section className={`rail-card legend-meta-card ${expanded ? "expanded" : ""}`}>
      <h2>Legend meta</h2>
      <div className="legend-meta-list">
        {rows.map((row) => (
          <button
            type="button"
            className="legend-meta-row interactive-row"
            data-active={selectedLegend === row.name}
            key={row.name}
            onClick={() => setSelectedLegend((current) => current === row.name ? "" : row.name)}
          >
            <LegendAvatar legend={row.name} />
            <div className="legend-meta-copy">
              <strong>{row.name}</strong>
              <div className="legend-meta-stats">
                <span>Games: {row.total}</span>
                <span>WR: {row.winRate}%</span>
                <span>W/L/D: {row.wins}/{row.losses}/{row.draws}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
      {!rows.length ? <p className="muted">No legend meta yet.</p> : null}
      {selectedLegend && selectedMatches.length ? (
        <div
          className="modal-backdrop matrix-popup-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedLegend("");
            }
          }}
        >
          <StatsDrilldown
            title={`${selectedLegend} stats`}
            subtitle="Matches where this legend was played in the current view."
            matches={selectedMatches}
            primaryLegend={selectedLegend}
            showFlags={showFlags}
            onClose={() => setSelectedLegend("")}
          />
        </div>
      ) : null}
    </section>
  );
}

function RecentMatchesPanel({ matches, showFlags = true }: { matches: AnalyticsMatch[]; showFlags?: boolean }) {
  const [selectedId, setSelectedId] = useState("");
  const recent = useMemo(
    () => [...matches].sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()).slice(0, 12),
    [matches]
  );
  const selectedMatch = useMemo(() => selectedId ? recent.find((match) => match.id === selectedId) : undefined, [recent, selectedId]);
  return (
    <>
      <section className="rail-card">
        <h2>Recent matches</h2>
        {recent.map((match) => (
          <button
            type="button"
            className="event-row recent-match-row interactive-row"
            data-active={selectedId === match.id}
            key={match.id}
            onClick={() => setSelectedId(match.id)}
          >
            <span>
              <strong>{match.myName || "Unknown player"} vs {match.opponentName || "Unknown opponent"}</strong>
              <em>{match.myChampion || "Unknown"} vs {match.opponentChampion || "unknown"}</em>
            </span>
            <strong>{match.result}{match.score ? ` ${match.score}` : ""}</strong>
          </button>
        ))}
        {!recent.length ? <p className="muted">Recent matches will appear here.</p> : null}
      </section>
      {selectedMatch ? (
        <div
          className="modal-backdrop matrix-popup-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedId("");
            }
          }}
        >
          <StatsDrilldown
            title={`${selectedMatch.myChampion} vs ${selectedMatch.opponentChampion}`}
            subtitle={`${selectedMatch.result}${selectedMatch.score ? ` ${selectedMatch.score}` : ""} - ${new Date(selectedMatch.capturedAt).toLocaleString()}`}
            matches={[selectedMatch]}
            primaryLegend={selectedMatch.myChampion}
            secondaryLegend={selectedMatch.opponentChampion}
            showFlags={showFlags}
            onClose={() => setSelectedId("")}
          />
        </div>
      ) : null}
    </>
  );
}

function MetaAlertsPanel({ matches, showFlags = true }: { matches: AnalyticsMatch[]; showFlags?: boolean }) {
  const [selectedTitle, setSelectedTitle] = useState("");
  const alerts = metaAlerts(matches);
  const selectedAlert = selectedTitle ? alerts.find((alert) => alert.title === selectedTitle) : undefined;
  const selectedMatches = selectedAlert ? matches.filter((match) => {
    if (selectedAlert.opponentLegend) {
      return match.myChampion === selectedAlert.legend &&
        match.opponentChampion === selectedAlert.opponentLegend &&
        (!selectedAlert.seat || match.wentFirst === selectedAlert.seat) &&
        (!selectedAlert.format || match.format === selectedAlert.format);
    }
    return match.myChampion === selectedAlert.legend &&
      (!selectedAlert.seat || match.wentFirst === selectedAlert.seat) &&
      (!selectedAlert.format || match.format === selectedAlert.format);
  }) : [];
  return (
    <section className="rail-card meta-alerts-card">
      <h2>Meta alerts</h2>
      <div className="meta-alerts-grid">
        {alerts.map((alert) => (
          <button
            type="button"
            className="alert-row interactive-row"
            data-active={selectedTitle === alert.title}
            key={alert.title}
            onClick={() => setSelectedTitle((current) => current === alert.title ? "" : alert.title)}
          >
            <strong>{alert.title}</strong>
            <span>{alert.summary}</span>
            <em>{alert.metric}</em>
          </button>
        ))}
      </div>
      {!alerts.length ? <p className="muted">No meaningful shifts yet. Alerts appear once there is enough recent and previous data.</p> : null}
      {selectedAlert && selectedMatches.length ? (
        <StatsDrilldown
          title={selectedAlert.title}
          subtitle={selectedAlert.summary}
          matches={selectedMatches}
          primaryLegend={selectedAlert.legend}
          secondaryLegend={selectedAlert.opponentLegend}
          showFlags={showFlags}
          onClose={() => setSelectedTitle("")}
        />
      ) : null}
    </section>
  );
}

function MatchupMatrixPanel({
  matches,
  filteredMatches,
  filters,
  emptyText,
  showFlags = true,
  onFilterChange,
  onResetFilters
}: {
  matches: AnalyticsMatch[];
  filteredMatches?: AnalyticsMatch[];
  filters?: MatrixFilters;
  emptyText: string;
  showFlags?: boolean;
  onFilterChange?: (key: keyof MatrixFilters, value: string) => void;
  onResetFilters?: () => void;
}) {
  const [selectedKey, setSelectedKey] = useState("");
  const [internalFilters, setInternalFilters] = useState<MatrixFilters>(DEFAULT_MATRIX_FILTERS);
  const activeFilters = filters ?? internalFilters;
  const internalFilteredMatches = useMemo(() => filterMatrixMatches(matches, activeFilters, showFlags), [matches, activeFilters, showFlags]);
  const visibleMatches = filteredMatches ?? internalFilteredMatches;
  const matrix = useMemo(() => matchupMatrix(visibleMatches), [visibleMatches]);
  const legends = useMemo(() => matrixLegendOptions(matches), [matches]);
  const showSourceFilter = matches.some((match) => match.source === "capture" || match.source === "scorepad" || match.source === "manual");
  const selectedCell = selectedKey ? matrix.lookup.get(selectedKey) : undefined;
  const [selectedMine, selectedOpp] = selectedKey.split("|||");
  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0
  });

  function setFilter(key: keyof MatrixFilters, value: string) {
    if (onFilterChange) {
      onFilterChange(key, value);
    } else {
      setInternalFilters((current) => ({ ...current, [key]: value }));
    }
    setSelectedKey("");
  }

  function resetFilters() {
    if (onResetFilters) {
      onResetFilters();
    } else {
      setInternalFilters(DEFAULT_MATRIX_FILTERS);
    }
    setSelectedKey("");
  }

  useEffect(() => {
    if (!selectedCell) {
      return;
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedKey("");
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedCell]);

  function startMatrixDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement).closest(".matrix-cell-button")) {
      dragRef.current.active = false;
      dragRef.current.moved = false;
      return;
    }
    const target = event.currentTarget;
    dragRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: target.scrollLeft,
      scrollTop: target.scrollTop
    };
    target.setPointerCapture(event.pointerId);
  }

  function moveMatrixDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag.active) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      event.currentTarget.classList.add("is-dragging");
    }
    if (drag.moved) {
      event.currentTarget.scrollLeft = drag.scrollLeft - dx;
      event.currentTarget.scrollTop = drag.scrollTop - dy;
      event.preventDefault();
    }
  }

  function stopMatrixDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current.active) {
      return;
    }
    dragRef.current.active = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    event.currentTarget.classList.remove("is-dragging");
    window.setTimeout(() => {
      dragRef.current.moved = false;
    }, 0);
  }

  if (!matrix.rows.length || !matrix.cols.length) {
    return (
      <section className="rail-card matrix-card">
        <MatrixHeader total={matches.length} filtered={visibleMatches.length} onReset={resetFilters} />
        <MatrixFiltersBar filters={activeFilters} legends={legends} showFlags={showFlags} showSource={showSourceFilter} onChange={setFilter} />
        <p className="muted">{emptyText}</p>
      </section>
    );
  }
  return (
    <>
      <section className="rail-card matrix-card">
        <MatrixHeader total={matches.length} filtered={visibleMatches.length} onReset={resetFilters} />
        <MatrixFiltersBar filters={activeFilters} legends={legends} showFlags={showFlags} showSource={showSourceFilter} onChange={setFilter} />
        <div
          className="matrix-scroll"
          onPointerDown={startMatrixDrag}
          onPointerMove={moveMatrixDrag}
          onPointerUp={stopMatrixDrag}
          onPointerCancel={stopMatrixDrag}
          onPointerLeave={stopMatrixDrag}
        >
          <table className="matchup-matrix">
            <thead>
              <tr>
                <th className="matrix-corner"><span>My Legend</span><em>vs Opp Legend</em></th>
                {matrix.cols.map((col) => (
                  <th key={col} className="matrix-col-heading">
                    <LegendAvatar legend={col} size="large" />
                    <span>{col}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row}>
                  <th className="matrix-row-heading">
                    <LegendAvatar legend={row} />
                    <div className="matrix-row-copy" title={row}>
                      <strong>{row}</strong>
                      <span>{legendRecord(visibleMatches, row)}</span>
                    </div>
                  </th>
                  {matrix.cols.map((col) => {
                    const cell = matrix.lookup.get(`${row}|||${col}`);
                    return (
                      <td key={`${row}:${col}`} data-tone={cell ? matchupTone(cell.winRate) : "empty"}>
                        {cell ? (
                          <button
                            type="button"
                            className="matrix-cell-button"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => setSelectedKey((current) => current === `${row}|||${col}` ? "" : `${row}|||${col}`)}
                            data-active={selectedKey === `${row}|||${col}`}
                            aria-haspopup="dialog"
                            title={`${row} vs ${col}: ${cell.winRate}% across ${cell.total} matches`}
                          >
                            <strong>{cell.winRate}%</strong>
                            <span>{cell.total} match{cell.total === 1 ? "" : "es"}</span>
                            <em>{cell.wins}-{cell.losses}{cell.draws ? `-${cell.draws}` : ""}</em>
                          </button>
                        ) : (
                          <span className="matrix-empty">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selectedCell ? (
        <div
          className="modal-backdrop matrix-popup-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedKey("");
            }
          }}
        >
          <MatrixDrilldown
            myLegend={selectedMine}
            opponentLegend={selectedOpp}
            cell={selectedCell}
            showFlags={showFlags}
            onClose={() => setSelectedKey("")}
          />
        </div>
      ) : null}
    </>
  );
}

function MatrixHeader({ total, filtered, onReset }: { total: number; filtered: number; onReset: () => void }) {
  return (
    <div className="matrix-header">
      <div>
        <h2>Match matrix</h2>
        <span>{filtered} of {total} matches analysed</span>
      </div>
      <button className="secondary" onClick={onReset}>Reset filters</button>
    </div>
  );
}

function MatrixFiltersBar({ filters, legends, showFlags = true, showSource = true, onChange }: {
  filters: MatrixFilters;
  legends: string[];
  showFlags?: boolean;
  showSource?: boolean;
  onChange: (key: keyof MatrixFilters, value: string) => void;
}) {
  return (
    <div className="matrix-filters">
      <label>Legend<select value={filters.legend} onChange={(event) => onChange("legend", event.target.value)}>
        <option value="">All legends</option>
        {legends.map((legend) => <option value={legend} key={legend}>{legend}</option>)}
      </select></label>
      <label>Result<select value={filters.result} onChange={(event) => onChange("result", event.target.value)}>
        <option value="">All results</option>
        <option value="Win">Wins</option>
        <option value="Loss">Losses</option>
        <option value="Draw">Draws</option>
      </select></label>
      <label>Format<select value={filters.format} onChange={(event) => onChange("format", event.target.value)}>
        <option value="">All formats</option>
        <option value="Bo1">Bo1</option>
        <option value="Bo3">Bo3</option>
      </select></label>
      {showSource ? <label>Source<select value={filters.source} onChange={(event) => onChange("source", event.target.value)}>
        <option value="">All sources</option>
        <option value="capture">Auto captured</option>
        <option value="scorepad">Scorepad</option>
      </select></label> : null}
      <label>Seat<select value={filters.seat} onChange={(event) => onChange("seat", event.target.value)}>
        <option value="">Any seat</option>
        <option value="1st">Went 1st</option>
        <option value="2nd">Went 2nd</option>
        <option value="undecided">Undecided / no seat</option>
        <option value="unknown">Unknown</option>
      </select></label>
      <label>Battlefield<input value={filters.battlefield} onChange={(event) => onChange("battlefield", event.target.value)} placeholder="Battlefield..." /></label>
      {showFlags ? <label>Flags<input value={filters.flags} onChange={(event) => onChange("flags", event.target.value)} placeholder="Flags..." /></label> : null}
    </div>
  );
}

function LegendAvatar({ legend, size = "normal" }: { legend: string; size?: "normal" | "large" }) {
  const [failed, setFailed] = useState(false);
  const url = legendImageUrl(legend);
  return (
    <span className={`legend-avatar ${size}`}>
      {url && !failed ? <img src={url} alt={legend} loading="lazy" onError={() => setFailed(true)} /> : <strong>{legendInitials(legend)}</strong>}
    </span>
  );
}

function MatrixDrilldown({ myLegend, opponentLegend, cell, showFlags = true, onClose }: {
  myLegend: string;
  opponentLegend: string;
  cell: MatrixCell;
  showFlags?: boolean;
  onClose: () => void;
}) {
  const [selectedMatch, setSelectedMatch] = useState<AnalyticsMatch | null>(null);
  const drilldownKey = `${myLegend}|${opponentLegend}|${cell.matches.map((match) => match.id).join("|")}`;
  const drilldownMatches = [...cell.matches].sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  const flags = topValueList(cell.matches.flatMap((match) => splitFlags(match.flags))).slice(0, 5);
  useEffect(() => {
    setSelectedMatch(null);
  }, [drilldownKey]);
  return (
    <section className="matrix-drilldown">
      <header>
        <div className="drilldown-title">
          <LegendAvatar legend={myLegend} size="large" />
          <div>
            <h3>{myLegend} into {opponentLegend}</h3>
            <span>{cell.wins}-{cell.losses}{cell.draws ? `-${cell.draws}` : ""} record across {cell.total} matches</span>
          </div>
          <LegendAvatar legend={opponentLegend} size="large" />
        </div>
        <button className="icon-button" onClick={onClose}>x</button>
      </header>
      <div className="drilldown-grid">
        <Metric label="Win rate" value={`${cell.winRate}%`} />
        <Metric label="Wins" value={String(cell.wins)} />
        <Metric label="Losses" value={String(cell.losses)} />
        <Metric label="Draws" value={String(cell.draws)} />
      </div>
      <div className="two-column drilldown-lists">
        <section className="drilldown-match-list">
          <h4>Matches</h4>
          {drilldownMatches.map((match) => (
            <button
              type="button"
              className="event-row recent-match-row interactive-row"
              data-active={selectedMatch?.id === match.id}
              key={match.id}
              onClick={() => setSelectedMatch((current) => current?.id === match.id ? null : match)}
            >
              <span>
                <strong>{match.myName || "Unknown player"} vs {match.opponentName || "Unknown opponent"}</strong>
                <em>{new Date(match.capturedAt).toLocaleDateString()} - {match.format} - {match.deckName || "No deck logged"}</em>
              </span>
              <strong>{match.result}{match.score ? ` ${match.score}` : ""}</strong>
            </button>
          ))}
        </section>
        {showFlags ? <section>
          <h4>Common flags</h4>
          {flags.map(([flag, count]) => <StatRow key={flag} label={flag} value={String(count)} />)}
          {!flags.length ? <p className="muted">No flags for this matchup yet.</p> : null}
        </section> : null}
      </div>
      {selectedMatch ? <MatchDetailPanel match={selectedMatch} showFlags={showFlags} /> : null}
    </section>
  );
}

function StatsDrilldown({ title, subtitle, matches, primaryLegend, secondaryLegend, showFlags = true, onClose }: StatsDrilldownSelection & { onClose: () => void }) {
  const [selectedMatch, setSelectedMatch] = useState<AnalyticsMatch | null>(null);
  const drilldownKey = `${title}|${primaryLegend ?? ""}|${secondaryLegend ?? ""}|${matches.map((match) => match.id).join("|")}`;
  const stats = analyticsResultStats(matches);
  const drilldownMatches = [...matches].sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  const legendMix = topValueList(matches.map((match) => match.myChampion).filter(Boolean)).slice(0, 6);
  const opponentMix = topValueList(matches.map((match) => match.opponentChampion).filter(Boolean)).slice(0, 6);
  const flags = topValueList(matches.flatMap((match) => splitFlags(match.flags))).slice(0, 6);
  useEffect(() => {
    setSelectedMatch(null);
  }, [drilldownKey]);
  return (
    <>
      <section className="matrix-drilldown stats-drilldown">
        <header>
          <div className="drilldown-title">
            {primaryLegend ? <LegendAvatar legend={primaryLegend} size="large" /> : null}
            <div>
              <h3>{title}</h3>
              <span>{subtitle || `${stats.games} completed match${stats.games === 1 ? "" : "es"} in this slice.`}</span>
            </div>
            {secondaryLegend ? <LegendAvatar legend={secondaryLegend} size="large" /> : null}
          </div>
          <button className="icon-button" onClick={onClose}>x</button>
        </header>
        <div className="drilldown-grid">
          <Metric label="Win rate" value={`${stats.winRate}%`} />
          <Metric label="Games" value={String(stats.games)} />
          <Metric label="Wins" value={String(stats.wins)} />
          <Metric label="Losses" value={String(stats.losses)} />
        </div>
        <div className="two-column drilldown-lists stats-drilldown-lists">
          <section className="drilldown-match-list">
            <h4>Matches</h4>
            {drilldownMatches.map((match) => (
              <button
                type="button"
                className="event-row recent-match-row interactive-row"
                data-active={selectedMatch?.id === match.id}
                key={match.id}
                onClick={() => setSelectedMatch((current) => current?.id === match.id ? null : match)}
              >
                <span>
                  <strong>{match.myName || "Unknown player"} vs {match.opponentName || "Unknown opponent"}</strong>
                  <em>{new Date(match.capturedAt).toLocaleDateString()} - {match.myChampion || "Unknown"} vs {match.opponentChampion || "unknown"} - {match.deckName || "No deck logged"}</em>
                </span>
                <strong>{match.result}{match.score ? ` ${match.score}` : ""}</strong>
              </button>
            ))}
            {!drilldownMatches.length ? <p className="muted">No matches in this slice yet.</p> : null}
          </section>
          <section>
            <h4>Legend mix</h4>
            {legendMix.map(([legend, count]) => <StatRow key={legend} label={legend} value={String(count)} />)}
            {!legendMix.length ? <p className="muted">No legend data for this slice.</p> : null}
          </section>
          <section>
            <h4>Opponent mix</h4>
            {opponentMix.map(([legend, count]) => <StatRow key={legend} label={legend} value={String(count)} />)}
            {!opponentMix.length ? <p className="muted">No opponent legend data for this slice.</p> : null}
          </section>
          {showFlags ? <section>
            <h4>Common flags</h4>
            {flags.map(([flag, count]) => <StatRow key={flag} label={flag} value={String(count)} />)}
            {!flags.length ? <p className="muted">No flags for this slice yet.</p> : null}
          </section> : null}
        </div>
      </section>
      {selectedMatch ? (
        <MatchDetailPopup
          match={selectedMatch}
          showFlags={showFlags}
          onClose={() => setSelectedMatch(null)}
        />
      ) : null}
    </>
  );
}

function MatchDetailPopup({ match, showFlags = true, onClose }: { match: AnalyticsMatch; showFlags?: boolean; onClose: () => void }) {
  return (
    <div
      className="modal-backdrop matrix-popup-backdrop match-detail-popup-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="match-detail-popup">
        <button className="icon-button match-detail-popup-close" onClick={onClose}>x</button>
        <MatchDetailPanel match={match} showFlags={showFlags} />
      </section>
    </div>
  );
}

function MatchDetailPanel({ match, showFlags = true }: { match: AnalyticsMatch; showFlags?: boolean }) {
  return (
    <section className="match-detail-panel">
      <header>
        <div>
          <h4>{match.myChampion || "Unknown"} vs {match.opponentChampion || "unknown"}</h4>
          <span>{new Date(match.capturedAt).toLocaleString()}</span>
        </div>
        <strong>{match.result}{match.score ? ` ${match.score}` : ""}</strong>
      </header>
      <div className="match-detail-grid">
        <Metric label="Player" value={match.myName || "Unknown"} />
        <Metric label="Opponent" value={match.opponentName || "Unknown"} />
        <Metric label="Seat" value={seatLabel(match.wentFirst)} />
        <Metric label="Deck" value={match.deckName || "Unknown"} />
        <Metric label="My battlefield" value={match.myBattlefield || "Unknown"} />
        <Metric label="Opponent battlefield" value={match.opponentBattlefield || "Unknown"} />
        <Metric label="Source" value={matchSourceLabel(match)} />
        {showFlags ? <Metric label="Flags" value={match.flags || "None"} /> : null}
      </div>
      {match.notes ? (
        <section className="match-notes-panel">
          <h5>Notes</h5>
          <p>{match.notes}</p>
        </section>
      ) : null}
      {match.games.length ? (
        <div className="match-games-panel">
          <h5>Games</h5>
          {match.games.map((game) => (
            <div className="match-game-row" key={`${match.id}:game:${game.gameNumber}`}>
              <strong>Game {game.gameNumber}</strong>
              <span>{game.result}</span>
              <span>{scoreTextFromGame(game) || "No score"}</span>
              <span>{seatLabel(game.wentFirst)}</span>
              <span>{gameBattlefieldLabel(match, game, "me")}</span>
              <span>{gameBattlefieldLabel(match, game, "opponent")}</span>
              <span>{extraBattlefieldLabel(game)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {match.deckSnapshotJson ? (
        <DeckCodePanel
          compact
          title={match.deckName || "Logged deck"}
          sourceUrl={match.deckSourceUrl}
          snapshotJson={match.deckSnapshotJson}
        />
      ) : null}
    </section>
  );
}

function gameBattlefieldLabel(match: AnalyticsMatch, game: MatchGame, side: "me" | "opponent"): string {
  const directValue = side === "me" ? game.myBattlefield : game.oppBattlefield;
  const matchFallback = game.gameNumber === 1 ? (side === "me" ? match.myBattlefield : match.opponentBattlefield) : "";
  return directValue || matchFallback || (side === "me" ? "My battlefield unknown" : "Opponent battlefield unknown");
}

function StatRow({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const content = <><strong>{label}</strong><span>{value}</span></>;
  if (onClick) {
    return <button type="button" className="browser-row interactive-row" onClick={onClick}>{content}</button>;
  }
  return <div className="browser-row"><strong>{label}</strong><span>{value}</span></div>;
}

function SyncPill({ match }: { match: MatchDraft }) {
  const hubStates = Object.values(match.sync.hubs);
  if (match.sync.community === "disabled" && hubStates.length) {
    const state = hubStates.includes("failed") ? "failed" : hubStates.every((item) => item === "synced") ? "synced" : "pending";
    return <span className={`sync-pill ${state}`}>hubs {state}</span>;
  }
  const state = match.sync.community;
  return <span className={`sync-pill ${state}`}>{state}</span>;
}

function Metric({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const content = <><span>{label}</span><strong>{value}</strong></>;
  if (onClick) {
    return <button type="button" className="metric metric-button" onClick={onClick}>{content}</button>;
  }
  return <div className="metric">{content}</div>;
}

function analyticsResultStats(matches: AnalyticsMatch[]): { games: number; wins: number; losses: number; draws: number; winRate: number } {
  const completed = matches.filter((match) => match.result !== "Incomplete");
  const wins = completed.filter((match) => match.result === "Win").length;
  const losses = completed.filter((match) => match.result === "Loss").length;
  const draws = completed.filter((match) => match.result === "Draw").length;
  const decisive = wins + losses;
  return {
    games: completed.length,
    wins,
    losses,
    draws,
    winRate: decisive ? Math.round((wins / decisive) * 100) : 0
  };
}

function topValue(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function topValueList(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
}

function latestPendingReviewMatch(
  matches: MatchDraft[],
  options: { maxAgeMs?: number; includeDismissed?: boolean } = {}
): MatchDraft | null {
  const now = Date.now();
  return [...matches]
    .filter((match) => match.status === "pending-review" || match.status === "incomplete")
    .filter((match) => options.includeDismissed || !isReviewDismissed(match))
    .filter((match) => {
      if (!options.maxAgeMs) {
        return true;
      }
      const capturedAt = new Date(match.updatedAt || match.capturedAt).getTime();
      return Number.isFinite(capturedAt) && now - capturedAt <= options.maxAgeMs;
    })
    .sort((a, b) => new Date(b.updatedAt || b.capturedAt).getTime() - new Date(a.updatedAt || a.capturedAt).getTime())[0] ?? null;
}

function reviewDismissStorageKey(match: MatchDraft): string {
  return `${REVIEW_DISMISS_PREFIX}${match.id}:${match.updatedAt || match.capturedAt}`;
}

function isReviewDismissed(match: MatchDraft): boolean {
  try {
    return window.localStorage.getItem(reviewDismissStorageKey(match)) === "1";
  } catch {
    return false;
  }
}

function markReviewDismissed(match: MatchDraft): void {
  try {
    window.localStorage.setItem(reviewDismissStorageKey(match), "1");
  } catch {
    // Non-critical; the match remains editable in local history.
  }
}

function clearDismissedReview(match: MatchDraft): void {
  try {
    window.localStorage.removeItem(reviewDismissStorageKey(match));
  } catch {
    // Non-critical; fresh capture events still open directly.
  }
}

function emptyScorepadGame(gameNumber: number): MatchGame {
  return {
    gameNumber,
    result: "Incomplete",
    myPoints: 0,
    oppPoints: 0,
    myBattlefield: "",
    oppBattlefield: "",
    wentFirst: ""
  };
}

function ensureScorepadBo3Games(games: MatchGame[]): MatchGame[] {
  const source = games.length ? games : [emptyScorepadGame(1)];
  const next = source.slice(0, 3).map((game, index) => normalizeReviewGame({ ...game, gameNumber: index + 1 }));
  while (next.length < 2) {
    next.push(emptyScorepadGame(next.length + 1));
  }
  return next;
}

function hasScorepadGameData(game: MatchGame): boolean {
  return game.result !== "Incomplete" ||
    Boolean(game.myPoints || game.oppPoints || game.myBattlefield || game.oppBattlefield || game.extraBattlefields?.length || game.wentFirst);
}

function newScorepadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function scorepadPhoneUrl(deviceId: string, secret: string): string {
  const params = new URLSearchParams({ device: deviceId, secret });
  return `https://www.riftlite.com/scorepad#${params.toString()}`;
}

function scorepadInboxEntryToDraft(
  entry: { id: string; match: unknown },
  settings: UserSettings,
  decks: SavedDeck[]
): MatchDraft | null {
  if (!entry.match || typeof entry.match !== "object" || Array.isArray(entry.match)) {
    return null;
  }
  const match = entry.match as Record<string, unknown>;
  const rawGames = Array.isArray(match.games) ? match.games : [];
  const games = rawGames.map((value, index) => readScorepadInboxGame(value, index)).filter((game): game is MatchGame => Boolean(game));
  const safeGames = games.length ? games : [emptyScorepadGame(1)];
  const format = readUnknownString(match.format) === "Bo3" || safeGames.length > 1 ? "Bo3" : "Bo1";
  const summary = reviewMatchSummary(safeGames, readGameResult(match.result) ?? safeGames[0]?.result ?? "Incomplete");
  const capturedAt = readUnknownString(match.capturedAt) || new Date().toISOString();
  const myChampion = normalizeLegendName(readUnknownString(match.myChampion));
  const deckName = readUnknownString(match.deckName);
  const matchedDeck = decks.find((deck) => {
    const sameName = deckName && deck.title.trim().toLowerCase() === deckName.trim().toLowerCase();
    const sameLegend = !myChampion || normalizeLegendName(deck.legend) === myChampion;
    return sameName && sameLegend;
  }) ?? null;
  const sourceNotes = [
    readUnknownString(match.eventName) ? `Event: ${readUnknownString(match.eventName)}` : "",
    readUnknownString(match.roundName) ? `Round: ${readUnknownString(match.roundName)}` : "",
    readUnknownString(match.notes)
  ].filter(Boolean).join("\n");
  return {
    id: `scorepad-phone-${entry.id}`,
    platform: "atlas",
    source: "scorepad",
    status: "pending-review",
    capturedAt,
    updatedAt: new Date().toISOString(),
    result: summary.result,
    format,
    score: summary.score,
    myName: settings.username || readUnknownString(match.myName) || "You",
    opponentName: readUnknownString(match.opponentName),
    myChampion: myChampion || normalizeLegendName(matchedDeck?.legend ?? ""),
    opponentChampion: normalizeLegendName(readUnknownString(match.opponentChampion)),
    myBattlefield: safeGames[0]?.myBattlefield ?? "",
    opponentBattlefield: safeGames[0]?.oppBattlefield ?? "",
    deckName: matchedDeck?.title ?? deckName,
    deckSourceId: matchedDeck?.sourceKey || matchedDeck?.id || "",
    deckSourceUrl: matchedDeck?.sourceUrl ?? "",
    deckSourceKey: matchedDeck?.sourceKey ?? "",
    deckSnapshotJson: matchedDeck?.snapshotJson ?? "",
    flags: "scorepad",
    notes: sourceNotes,
    games: safeGames,
    rawEvidence: [],
    sync: {
      community: "disabled",
      hubs: {}
    }
  };
}

function readScorepadInboxGame(value: unknown, index: number): MatchGame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const game = value as Record<string, unknown>;
  const myPoints = normalizeOptionalScore(game.myPoints);
  const oppPoints = normalizeOptionalScore(game.oppPoints);
  return normalizeReviewGame({
    gameNumber: index + 1,
    result: readGameResult(game.result) ?? inferReviewResult(myPoints, oppPoints),
    myPoints,
    oppPoints,
    myBattlefield: readUnknownString(game.myBattlefield),
    oppBattlefield: readUnknownString(game.oppBattlefield),
    extraBattlefields: normalizeExtraBattlefields(game.extraBattlefields ?? game.extra_battlefields ?? game.specialBattlefields),
    wentFirst: normalizeWentFirst(game.wentFirst)
  });
}

function matchSource(match: Pick<MatchDraft, "source">): NonNullable<MatchDraft["source"]> {
  return match.source ?? "capture";
}

function matchSourceLabel(match: Pick<MatchDraft, "source" | "platform"> | AnalyticsMatch): string {
  const source = "source" in match ? match.source : "capture";
  if (source === "scorepad") {
    return "Scorepad";
  }
  if (source === "manual") {
    return "Manual";
  }
  if (match.platform === "tcga") {
    return "TCGA";
  }
  if (match.platform === "atlas") {
    return "Atlas";
  }
  if (match.platform === "community") {
    return "Community";
  }
  return "Hub";
}

function localToAnalytics(match: MatchDraft): AnalyticsMatch {
  const primaryGame = match.games[0];
  const games = match.games.map((game, index) => ({ ...normalizeReviewGame(game), gameNumber: game.gameNumber || index + 1 }));
  return {
    id: match.id,
    platform: match.platform,
    source: matchSource(match),
    result: match.result,
    myName: match.myName || "You",
    myChampion: canonicalLegendName(match.myChampion),
    opponentChampion: canonicalLegendName(match.opponentChampion),
    opponentName: match.opponentName,
    format: match.format,
    score: match.score,
    deckName: match.deckName,
    deckSourceUrl: match.deckSourceUrl ?? "",
    deckSourceKey: match.deckSourceKey || match.deckSourceId,
    deckSnapshotJson: match.deckSnapshotJson ?? "",
    flags: match.flags,
    notes: match.notes,
    capturedAt: match.capturedAt,
    wentFirst: primaryGame?.wentFirst ?? "",
    myBattlefield: match.myBattlefield || primaryGame?.myBattlefield || "",
    opponentBattlefield: match.opponentBattlefield || primaryGame?.oppBattlefield || "",
    games
  };
}

function communityToAnalytics(match: CommunityMatch): AnalyticsMatch {
  const games = applyCommunityGameFallbacks(parseCommunityGames(match.gamesJson), match);
  const primaryGame = games[0];
  return {
    id: match.id,
    platform: match.scope,
    source: match.scope,
    result: match.result,
    myName: match.username || "Unknown",
    myChampion: canonicalLegendName(match.myChampion),
    opponentChampion: canonicalLegendName(match.opponentChampion),
    opponentName: match.opponentName,
    format: match.format,
    score: match.score,
    deckName: match.deckName,
    deckSourceUrl: match.deckSourceUrl,
    deckSourceKey: match.deckSourceKey,
    deckSnapshotJson: match.deckSnapshotJson,
    flags: match.flags,
    notes: "",
    capturedAt: match.date || new Date(match.createdAt * 1000).toISOString(),
    wentFirst: match.wentFirst || primaryGame?.wentFirst || "",
    myBattlefield: match.myBattlefield || primaryGame?.myBattlefield || "",
    opponentBattlefield: match.opponentBattlefield || primaryGame?.oppBattlefield || "",
    games
  };
}

function applyCommunityGameFallbacks(games: MatchGame[], match: CommunityMatch): MatchGame[] {
  if (!games.length) {
    return games;
  }
  const matchMyBattlefield = readUnknownString(match.myBattlefield);
  const matchOpponentBattlefield = readUnknownString(match.opponentBattlefield);
  const matchSeat = normalizeWentFirst(match.wentFirst);
  const canUseMatchBattlefields = games.length === 1 || match.format !== "Bo3";
  return games.map((game, index) => ({
    ...game,
    wentFirst: game.wentFirst || matchSeat,
    myBattlefield: game.myBattlefield || (canUseMatchBattlefields || index === 0 ? matchMyBattlefield : ""),
    oppBattlefield: game.oppBattlefield || (canUseMatchBattlefields || index === 0 ? matchOpponentBattlefield : "")
  }));
}

function normalizeExtraBattlefields(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,|]/)
      : [];
  const selected = new Set<string>();
  for (const item of rawValues) {
    const text = readUnknownString(item);
    const allowed = SPECIAL_BATTLEFIELD_KEYS.get(text.toLowerCase());
    if (allowed) {
      selected.add(allowed);
    }
  }
  return [...selected];
}

function extraBattlefieldLabel(game: MatchGame): string {
  const extra = normalizeExtraBattlefields(game.extraBattlefields);
  return extra.length ? `Extra: ${extra.join(", ")}` : "No extra battlefield";
}

function nextExtraBattlefields(current: unknown, name: string, checked: boolean): string[] {
  const selected = new Set(normalizeExtraBattlefields(current));
  if (checked) {
    selected.add(name);
  } else {
    selected.delete(name);
  }
  return [...selected];
}

function parseCommunityGames(gamesJson: string): MatchGame[] {
  if (!gamesJson.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(gamesJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(readCommunityGame).filter((game): game is MatchGame => Boolean(game));
  } catch {
    return [];
  }
}

function readCommunityGame(value: unknown, index: number): MatchGame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const game = value as Record<string, unknown>;
  const gameNumber = readFirstOptionalScore(game.gameNumber, game.game_number, game.number) ?? index + 1;
  const myPoints = readFirstOptionalScore(game.myPoints, game.my_points, game.myScore, game.my_score, game.me, game.my);
  const oppPoints = readFirstOptionalScore(
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
  );
  const result = readGameResult(readFirstUnknownString(game.result, game.outcome)) ?? inferReviewResult(myPoints, oppPoints);
  return {
    gameNumber,
    result,
    myPoints,
    oppPoints,
    myBattlefield: readFirstUnknownString(game.myBattlefield, game.myBf, game.my_bf, game.my_battlefield, game.playerBattlefield, game.player_battlefield),
    oppBattlefield: readFirstUnknownString(
      game.oppBattlefield,
      game.opponentBattlefield,
      game.oppBf,
      game.opp_bf,
      game.opponent_battlefield,
      game.enemyBattlefield,
      game.enemy_battlefield
    ),
    extraBattlefields: normalizeExtraBattlefields(
      game.extraBattlefields ??
      game.extra_battlefields ??
      game.specialBattlefields ??
      game.special_battlefields ??
      game.thirdBattlefields ??
      game.third_battlefields
    ),
    wentFirst: readFirstWentFirst(game.wentFirst, game.went_first, game.seat)
  };
}

function readGameResult(value: unknown): MatchGame["result"] | null {
  const raw = readUnknownString(value);
  return raw === "Win" || raw === "Loss" || raw === "Draw" || raw === "Incomplete" ? raw : null;
}

function readFirstOptionalScore(...values: unknown[]): number | undefined {
  for (const value of values) {
    const score = normalizeOptionalScore(value);
    if (typeof score === "number") {
      return score;
    }
  }
  return undefined;
}

function readFirstWentFirst(...values: unknown[]): MatchGame["wentFirst"] {
  for (const value of values) {
    const seat = normalizeWentFirst(value);
    if (seat) {
      return seat;
    }
  }
  return "";
}

function readFirstUnknownString(...values: unknown[]): string {
  for (const value of values) {
    const text = readUnknownString(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function readUnknownString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validAnalytics(matches: AnalyticsMatch[]): AnalyticsMatch[] {
  return matches.filter((match) => match.myChampion && match.opponentChampion);
}

function filterAnalyticsByFormat(matches: AnalyticsMatch[], format: string): AnalyticsMatch[] {
  return format ? matches.filter((match) => match.format === format) : matches;
}

function splitFlags(flags: string): string[] {
  return flags.split(",").map((flag) => flag.trim()).filter(Boolean);
}

function filterMatrixMatches(matches: AnalyticsMatch[], filters: MatrixFilters, showFlags = true): AnalyticsMatch[] {
  const battlefield = filters.battlefield.trim().toLowerCase();
  const flags = showFlags ? filters.flags.trim().toLowerCase() : "";
  return matches.filter((match) => {
    if (match.result === "Incomplete") return false;
    if (filters.legend && match.myChampion !== filters.legend && match.opponentChampion !== filters.legend) return false;
    if (filters.result && match.result !== filters.result) return false;
    if (filters.format && match.format !== filters.format) return false;
    if (filters.source && match.source !== filters.source) return false;
    if (filters.seat && !analyticsMatchMatchesSeat(match, filters.seat)) return false;
    if (battlefield && !`${match.myBattlefield} ${match.opponentBattlefield}`.toLowerCase().includes(battlefield)) return false;
    if (flags && !match.flags.toLowerCase().includes(flags)) return false;
    return true;
  });
}

function analyticsMatchMatchesSeat(match: AnalyticsMatch, filter: string): boolean {
  const seats = [
    normalizeWentFirst(match.wentFirst),
    ...match.games.map((game) => normalizeWentFirst(game.wentFirst))
  ].filter(Boolean);
  if (filter === "unknown") {
    return !seats.length;
  }
  return seats.includes(normalizeWentFirst(filter));
}

function matrixLegendOptions(matches: AnalyticsMatch[]): string[] {
  return [...new Set(matches.flatMap((match) => [match.myChampion, match.opponentChampion]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function sideLegendOptions(matches: AnalyticsMatch[], side: "me" | "opponent"): string[] {
  return [...new Set(matches.map((match) => side === "me" ? match.myChampion : match.opponentChampion).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function matchupMatrix(matches: AnalyticsMatch[]): {
  rows: string[];
  cols: string[];
  lookup: Map<string, MatrixCell>;
} {
  const lookup = new Map<string, MatrixCell>();
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  for (const match of matches) {
    const my = match.myChampion || "";
    const opp = match.opponentChampion || "";
    if (!my || !opp || match.result === "Incomplete") {
      continue;
    }
    const key = `${my}|||${opp}`;
    const current = lookup.get(key) ?? { wins: 0, losses: 0, draws: 0, total: 0, winRate: 0, matches: [] };
    if (match.result === "Win") current.wins += 1;
    if (match.result === "Loss") current.losses += 1;
    if (match.result === "Draw") current.draws += 1;
    current.total += 1;
    current.matches.push(match);
    const decisive = current.wins + current.losses;
    current.winRate = decisive ? Math.round((current.wins / decisive) * 100) : 50;
    lookup.set(key, current);
    rowTotals.set(my, (rowTotals.get(my) ?? 0) + 1);
    colTotals.set(opp, (colTotals.get(opp) ?? 0) + 1);
  }
  const rows = [...rowTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  const cols = [...colTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  return { rows, cols, lookup };
}

function legendRecord(matches: AnalyticsMatch[], legend: string): string {
  const mine = matches.filter((match) => match.myChampion === legend && match.result !== "Incomplete");
  const wins = mine.filter((match) => match.result === "Win").length;
  const losses = mine.filter((match) => match.result === "Loss").length;
  const draws = mine.filter((match) => match.result === "Draw").length;
  const decisive = wins + losses;
  const winRate = decisive ? Math.round((wins / decisive) * 100) : 0;
  return `WR: ${winRate}% | Games: ${mine.length} | ${wins}-${losses}${draws ? `-${draws}` : ""}`;
}

function matchupTone(winRate: number): string {
  const normalized = Math.max(0, Math.min(100, winRate));
  if (normalized >= 70) return "great";
  if (normalized >= 56) return "good";
  if (normalized >= 45) return "even";
  if (normalized >= 30) return "bad";
  return "awful";
}

function legendInitials(legend: string): string {
  return legend
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function metaAlerts(matches: AnalyticsMatch[]): MetaAlert[] {
  const ordered = [...matches]
    .filter((match) => match.myChampion && match.result !== "Incomplete")
    .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  const windowSize = Math.min(50, Math.max(20, Math.floor(ordered.length / 2)));
  const recent = ordered.slice(0, windowSize);
  const previous = ordered.slice(windowSize, windowSize * 2);
  if (recent.length < 8) {
    return [];
  }
  const alerts: MetaAlert[] = [];
  if (previous.length >= 10) {
    const recentLegend = legendWindow(recent);
    const previousLegend = legendWindow(previous);
    for (const legend of new Set([...recentLegend.keys(), ...previousLegend.keys()])) {
      const nowStats = recentLegend.get(legend) ?? { wins: 0, losses: 0, total: 0 };
      const oldStats = previousLegend.get(legend) ?? { wins: 0, losses: 0, total: 0 };
      const usageNow = nowStats.total / recent.length;
      const usageOld = oldStats.total / previous.length;
      const usageDelta = usageNow - usageOld;
      if (nowStats.total >= 6 && Math.abs(usageDelta) >= 0.08) {
        alerts.push({
          title: `${legend} usage is ${usageDelta > 0 ? "rising" : "falling"}`,
          summary: `Moved from ${percent(usageOld)} to ${percent(usageNow)} of matches in the latest window.`,
          metric: `Usage ${signedPercent(usageDelta)}`,
          score: Math.abs(usageDelta) * 120 + nowStats.total,
          legend
        });
      }
      const nowDecisive = nowStats.wins + nowStats.losses;
      const oldDecisive = oldStats.wins + oldStats.losses;
      if (nowDecisive >= 6 && oldDecisive >= 6) {
        const wrNow = nowStats.wins / nowDecisive;
        const wrOld = oldStats.wins / oldDecisive;
        const wrDelta = wrNow - wrOld;
        if (Math.abs(wrDelta) >= 0.12) {
          alerts.push({
            title: `${legend} win rate is ${wrDelta > 0 ? "climbing" : "dropping"}`,
            summary: `Shifted from ${percent(wrOld)} to ${percent(wrNow)} across recent matches.`,
            metric: `Win rate ${signedPercent(wrDelta)}`,
            score: Math.abs(wrDelta) * 140 + nowDecisive,
            legend
          });
        }
      }
    }
    const recentMatrix = matchupWindow(recent);
    const previousMatrix = matchupWindow(previous);
    for (const key of new Set([...recentMatrix.keys(), ...previousMatrix.keys()])) {
      const nowStats = recentMatrix.get(key) ?? { wins: 0, losses: 0 };
      const oldStats = previousMatrix.get(key) ?? { wins: 0, losses: 0 };
      const nowDecisive = nowStats.wins + nowStats.losses;
      const oldDecisive = oldStats.wins + oldStats.losses;
      if (nowDecisive < 5 || oldDecisive < 5) {
        continue;
      }
      const wrNow = nowStats.wins / nowDecisive;
      const wrOld = oldStats.wins / oldDecisive;
      const delta = wrNow - wrOld;
      if (Math.abs(delta) >= 0.18) {
        const [my, opp] = key.split("|||");
        alerts.push({
          title: `${my} into ${opp} is ${delta > 0 ? "trending up" : "sliding"}`,
          summary: `This matchup moved from ${percent(wrOld)} to ${percent(wrNow)} in the latest windows.`,
          metric: `Matchup ${signedPercent(delta)}`,
          score: Math.abs(delta) * 150 + nowDecisive,
          legend: my,
          opponentLegend: opp
        });
      }
    }
  }
  alerts.push(...seatMetaAlerts(recent));
  return alerts.sort((a, b) => b.score - a.score).slice(0, 5);
}

function seatMetaAlerts(matches: AnalyticsMatch[]): MetaAlert[] {
  const rows = new Map<string, { wins: number; losses: number; draws: number; total: number; legend: string; seat: string }>();
  for (const match of matches) {
    if (!match.myChampion || (match.wentFirst !== "1st" && match.wentFirst !== "2nd")) {
      continue;
    }
    const key = `${match.myChampion}|||${match.wentFirst}`;
    const row = rows.get(key) ?? { wins: 0, losses: 0, draws: 0, total: 0, legend: match.myChampion, seat: match.wentFirst };
    row.total += 1;
    if (match.result === "Win") row.wins += 1;
    if (match.result === "Loss") row.losses += 1;
    if (match.result === "Draw") row.draws += 1;
    rows.set(key, row);
  }
  return [...rows.values()].flatMap((row) => {
    const decisive = row.wins + row.losses;
    if (decisive < 5) {
      return [];
    }
    const winRate = row.wins / decisive;
    if (winRate < 0.62 && winRate > 0.38) {
      return [];
    }
    return [{
      title: `${row.legend} going ${row.seat} is ${winRate >= 0.5 ? "strong" : "struggling"}`,
      summary: `${row.legend} has a ${percent(winRate)} win rate when going ${row.seat} across ${decisive} recent decisive matches.`,
      metric: `Seat WR ${percent(winRate)} | ${row.wins}-${row.losses}`,
      score: Math.abs(winRate - 0.5) * 110 + decisive,
      legend: row.legend,
      seat: row.seat
    }];
  });
}

function legendWindow(matches: AnalyticsMatch[]): Map<string, { wins: number; losses: number; total: number }> {
  const rows = new Map<string, { wins: number; losses: number; total: number }>();
  for (const match of matches) {
    const legend = match.myChampion || "Unknown";
    const row = rows.get(legend) ?? { wins: 0, losses: 0, total: 0 };
    row.total += 1;
    if (match.result === "Win") row.wins += 1;
    if (match.result === "Loss") row.losses += 1;
    rows.set(legend, row);
  }
  return rows;
}

function matchupWindow(matches: AnalyticsMatch[]): Map<string, { wins: number; losses: number }> {
  const rows = new Map<string, { wins: number; losses: number }>();
  for (const match of matches) {
    if (!match.myChampion || !match.opponentChampion) continue;
    const key = `${match.myChampion}|||${match.opponentChampion}`;
    const row = rows.get(key) ?? { wins: 0, losses: 0 };
    if (match.result === "Win") row.wins += 1;
    if (match.result === "Loss") row.losses += 1;
    rows.set(key, row);
  }
  return rows;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
}

function leaderboardRows(matches: AnalyticsMatch[]): Array<{ name: string; games: number; wins: number; losses: number; draws: number; winRate: number; score: number }> {
  const rows = new Map<string, { wins: number; losses: number; draws: number }>();
  for (const match of matches) {
    const name = match.myName || "You";
    const row = rows.get(name) ?? { wins: 0, losses: 0, draws: 0 };
    if (match.result === "Win") row.wins += 1;
    if (match.result === "Loss") row.losses += 1;
    if (match.result === "Draw") row.draws += 1;
    rows.set(name, row);
  }
  return [...rows.entries()].map(([name, row]) => {
    const decisive = row.wins + row.losses;
    const games = decisive + row.draws;
    return {
      name,
      games,
      ...row,
      winRate: decisive ? (row.wins / decisive) * 100 : 0,
      score: wilsonScore(row.wins, row.losses)
    };
  }).sort((a, b) => b.score - a.score || b.games - a.games || a.name.localeCompare(b.name));
}

function wilsonScore(wins: number, losses: number): number {
  const n = wins + losses;
  if (!n) return 0;
  const z = 1.96;
  const phat = wins / n;
  const denominator = 1 + (z * z) / n;
  const centre = phat + (z * z) / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
  return Math.max(0, ((centre - margin) / denominator) * 100);
}

function legendRows(matches: AnalyticsMatch[]): Array<{ name: string; total: number; wins: number; losses: number; draws: number; winRate: number }> {
  const rows = new Map<string, { total: number; wins: number; losses: number; draws: number }>();
  for (const match of matches) {
    const name = match.myChampion || "Unknown";
    const row = rows.get(name) ?? { total: 0, wins: 0, losses: 0, draws: 0 };
    row.total += 1;
    if (match.result === "Win") row.wins += 1;
    if (match.result === "Loss") row.losses += 1;
    if (match.result === "Draw") row.draws += 1;
    rows.set(name, row);
  }
  return [...rows.entries()].map(([name, row]) => ({
    name,
    total: row.total,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    winRate: row.wins + row.losses ? Math.round((row.wins / (row.wins + row.losses)) * 100) : 0
  })).sort((a, b) => b.total - a.total);
}

function normalizeReviewDraft(draft: MatchDraft): MatchDraft {
  const workingDraft = repairDraftForReview(draft);
  const games = ensureReviewGames(workingDraft, workingDraft.format).map((game, index) => normalizeReviewGame({ ...game, gameNumber: index + 1 }));
  const deckSourceKey = workingDraft.deckSourceKey || workingDraft.deckSourceId || "";
  if (games[0] && games.length === 1) {
    games[0] = {
      ...games[0],
      myBattlefield: workingDraft.myBattlefield || games[0].myBattlefield,
      oppBattlefield: workingDraft.opponentBattlefield || games[0].oppBattlefield,
      wentFirst: normalizeWentFirst(games[0].wentFirst)
    };
  }
  const summary = reviewMatchSummary(games, workingDraft.result);
  const selectedResult = readGameResult(workingDraft.result) ?? summary.result;
  return {
    ...workingDraft,
    myChampion: normalizeLegendName(workingDraft.myChampion),
    opponentChampion: normalizeLegendName(workingDraft.opponentChampion),
    format: games.length > 1 ? "Bo3" : workingDraft.format,
    result: selectedResult,
    score: summary.score || workingDraft.score.trim(),
    myBattlefield: workingDraft.myBattlefield || games[0]?.myBattlefield || "",
    opponentBattlefield: workingDraft.opponentBattlefield || games[0]?.oppBattlefield || "",
    deckName: workingDraft.deckName.trim(),
    deckSourceId: deckSourceKey,
    deckSourceKey,
    deckSourceUrl: workingDraft.deckSourceUrl ?? "",
    deckSnapshotJson: workingDraft.deckSnapshotJson ?? "",
    games
  };
}

function repairDraftForReview(draft: MatchDraft): MatchDraft {
  if (!draft.games.length) {
    return draft;
  }
  const syntheticIndexes = new Set<number>();
  draft.games.forEach((game, index) => {
    if (isSyntheticZeroReviewGame(game)) {
      syntheticIndexes.add(index);
    }
  });
  if (!syntheticIndexes.size) {
    return draft;
  }
  const normalizedGames = draft.games.map((game, index) => normalizeReviewGame({ ...game, gameNumber: index + 1 }));
  const substantiveGames = normalizedGames.filter((game, index) => !syntheticIndexes.has(index) && reviewGameHasData(game));
  if (!substantiveGames.length) {
    return draft;
  }
  const games = substantiveGames.map((game, index) => normalizeReviewGame({ ...game, gameNumber: index + 1 }));
  const summary = reviewMatchSummary(games, draft.result);
  const format = games.length > 1 ? "Bo3" : "Bo1";
  const primary = games[0] ?? createReviewGame(draft, 1);
  return {
    ...draft,
    format,
    games,
    result: summary.result,
    score: summary.score || draft.score,
    myBattlefield: primary.myBattlefield || draft.myBattlefield,
    opponentBattlefield: primary.oppBattlefield || draft.opponentBattlefield
  };
}

function normalizeReviewGame(game: MatchDraft["games"][number]): MatchDraft["games"][number] {
  const myPoints = normalizeOptionalScore(game.myPoints);
  const oppPoints = normalizeOptionalScore(game.oppPoints);
  const explicitResult = readGameResult(game.result);
  const inferredResult = inferReviewResult(myPoints, oppPoints);
  return {
    ...game,
    myPoints,
    oppPoints,
    result: explicitResult === "Draw" && myPoints === 0 && oppPoints === 0 ? inferredResult : explicitResult ?? inferredResult,
    myBattlefield: readUnknownString(game.myBattlefield),
    oppBattlefield: readUnknownString(game.oppBattlefield),
    myBattlefieldImage: readUnknownString(game.myBattlefieldImage),
    oppBattlefieldImage: readUnknownString(game.oppBattlefieldImage),
    extraBattlefields: normalizeExtraBattlefields(game.extraBattlefields),
    wentFirst: normalizeWentFirst(game.wentFirst)
  };
}

function createReviewGame(draft: MatchDraft, gameNumber = 1): MatchDraft["games"][number] {
  return {
    gameNumber,
    result: gameNumber === 1 ? draft.result : "Incomplete",
    myBattlefield: gameNumber === 1 ? draft.myBattlefield : "",
    oppBattlefield: gameNumber === 1 ? draft.opponentBattlefield : "",
    extraBattlefields: [],
    wentFirst: ""
  };
}

function createEmptyReviewGame(gameNumber = 1): MatchDraft["games"][number] {
  return {
    gameNumber,
    result: "Incomplete",
    myBattlefield: "",
    oppBattlefield: "",
    extraBattlefields: [],
    wentFirst: ""
  };
}

function ensureReviewGames(draft: MatchDraft, format: MatchDraft["format"]): MatchGame[] {
  const wantsBo3 = format === "Bo3" || (format === "Auto" && draft.games.length > 1);
  const source = draft.games.length ? draft.games : [createReviewGame(draft)];
  const games = source.map((game, index) => normalizeReviewGame({ ...game, gameNumber: index + 1 }));
  if (!wantsBo3) {
    return games.slice(0, 1);
  }
  while (games.length < 2) {
    games.push(createReviewGame(draft, games.length + 1));
  }
  return games.slice(0, 3).map((game, index) => ({ ...game, gameNumber: index + 1 }));
}

function reviewGamesFromEvidence(draft: MatchDraft): MatchGame[] {
  const events = [...draft.rawEvidence].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
  const games: MatchGame[] = [];
  let current = createEmptyReviewGame(1);

  for (const event of events) {
    if (!["match-start", "match-snapshot", "match-update", "match-end"].includes(event.kind)) {
      continue;
    }
    const score = scoreFromEvidencePayload(event.payload);
    const rawMyBattlefield = readUnknownString(event.payload.myBattlefield);
    const rawOppBattlefield = readUnknownString(event.payload.opponentBattlefield);
    const rawMyBattlefieldImage = readUnknownString(event.payload.myBattlefieldImage);
    const rawOppBattlefieldImage = readUnknownString(event.payload.opponentBattlefieldImage);
    const myBattlefield = isGeneratedBattlefieldName(rawMyBattlefield) ? "" : rawMyBattlefield;
    const oppBattlefield = isGeneratedBattlefieldName(rawOppBattlefield) ? "" : rawOppBattlefield;
    const myBattlefieldImage = isGeneratedBattlefieldImage(rawMyBattlefieldImage) ? "" : rawMyBattlefieldImage || battlefieldImageFromEvidencePayload(event.payload, "me");
    const oppBattlefieldImage = isGeneratedBattlefieldImage(rawOppBattlefieldImage) ? "" : rawOppBattlefieldImage || battlefieldImageFromEvidencePayload(event.payload, "opponent");
    if (shouldStartEvidenceGame(current, score, myBattlefield, oppBattlefield, myBattlefieldImage, oppBattlefieldImage)) {
      games.push(normalizeReviewGame(current));
      current = createEmptyReviewGame(games.length + 1);
    }
    if (typeof score.me === "number") {
      current.myPoints = Math.max(current.myPoints ?? score.me, score.me);
    }
    if (typeof score.opp === "number") {
      current.oppPoints = Math.max(current.oppPoints ?? score.opp, score.opp);
    }
    if (myBattlefield) {
      current.myBattlefield = myBattlefield;
    }
    if (oppBattlefield) {
      current.oppBattlefield = oppBattlefield;
    }
    if (myBattlefieldImage) {
      current.myBattlefieldImage = myBattlefieldImage;
    }
    if (oppBattlefieldImage) {
      current.oppBattlefieldImage = oppBattlefieldImage;
    }
    current.result = inferReviewResult(current.myPoints, current.oppPoints);
  }

  if (reviewGameHasData(current)) {
    games.push(normalizeReviewGame(current));
  }
  return cleanEvidenceReviewGames(games).slice(0, 3).map((game, index) => ({ ...game, gameNumber: index + 1 }));
}

function scoreFromEvidencePayload(payload: Record<string, unknown>): { me?: number; opp?: number } {
  const score = payload.score;
  if (!score || typeof score !== "object" || Array.isArray(score)) {
    return {};
  }
  const raw = score as Record<string, unknown>;
  return {
    me: normalizeOptionalScore(raw.me),
    opp: normalizeOptionalScore(raw.opp)
  };
}

function shouldStartEvidenceGame(
  current: MatchGame,
  score: { me?: number; opp?: number },
  myBattlefield: string,
  oppBattlefield: string,
  myBattlefieldImage: string,
  oppBattlefieldImage: string
): boolean {
  if (!reviewGameHasData(current)) {
    return false;
  }
  const nextHasScore = (score.me ?? 0) + (score.opp ?? 0) > 0;
  const canSplitOnFieldChange = reviewGameHasNonZeroScore(current) && nextHasScore;
  if (
    isGeneratedBattlefieldName(myBattlefield) ||
    isGeneratedBattlefieldName(oppBattlefield) ||
    isGeneratedBattlefieldImage(myBattlefieldImage) ||
    isGeneratedBattlefieldImage(oppBattlefieldImage)
  ) {
    return false;
  }
  if (canSplitOnFieldChange && myBattlefield && current.myBattlefield && normalizeTextKey(myBattlefield) !== normalizeTextKey(current.myBattlefield)) {
    return true;
  }
  if (canSplitOnFieldChange && oppBattlefield && current.oppBattlefield && normalizeTextKey(oppBattlefield) !== normalizeTextKey(current.oppBattlefield)) {
    return true;
  }
  if (canSplitOnFieldChange && myBattlefieldImage && current.myBattlefieldImage && normalizeAssetKey(myBattlefieldImage) !== normalizeAssetKey(current.myBattlefieldImage)) {
    return true;
  }
  if (canSplitOnFieldChange && oppBattlefieldImage && current.oppBattlefieldImage && normalizeAssetKey(oppBattlefieldImage) !== normalizeAssetKey(current.oppBattlefieldImage)) {
    return true;
  }
  if (typeof score.me !== "number" && typeof score.opp !== "number") {
    return false;
  }
  const currentMe = normalizeOptionalScore(current.myPoints) ?? 0;
  const currentOpp = normalizeOptionalScore(current.oppPoints) ?? 0;
  const nextMe = score.me ?? currentMe;
  const nextOpp = score.opp ?? currentOpp;
  const currentTotal = currentMe + currentOpp;
  const nextTotal = nextMe + nextOpp;
  return nextTotal > 0 && (nextMe < currentMe || nextOpp < currentOpp) && currentTotal >= 6 && nextTotal <= currentTotal - 2;
}

function reviewGameHasData(game: MatchGame): boolean {
  const hasScore = reviewGameHasAnyScore(game);
  if (hasScore && !reviewGameHasNonZeroScore(game) && game.result === "Incomplete") {
    return false;
  }
  return reviewGameHasNonZeroScore(game) ||
    (hasScore && game.result !== "Incomplete") ||
    Boolean(game.myBattlefield || game.oppBattlefield || game.myBattlefieldImage || game.oppBattlefieldImage || game.extraBattlefields?.length || game.wentFirst);
}

function reviewGameHasAnyScore(game: MatchGame): boolean {
  return typeof normalizeOptionalScore(game.myPoints) === "number" || typeof normalizeOptionalScore(game.oppPoints) === "number";
}

function reviewGameHasNonZeroScore(game: MatchGame): boolean {
  return (normalizeOptionalScore(game.myPoints) ?? 0) > 0 || (normalizeOptionalScore(game.oppPoints) ?? 0) > 0;
}

function isSyntheticZeroReviewGame(game: MatchGame): boolean {
  const myPoints = normalizeOptionalScore(game.myPoints);
  const oppPoints = normalizeOptionalScore(game.oppPoints);
  const result = readGameResult(game.result);
  return myPoints === 0 && oppPoints === 0 && (result === "Draw" || result === "Incomplete");
}

function cleanEvidenceReviewGames(games: MatchGame[]): MatchGame[] {
  const normalized = games.map(normalizeReviewGame).filter(reviewGameHasData);
  if (normalized.some(reviewGameHasNonZeroScore)) {
    return normalized.filter((game) => reviewGameHasNonZeroScore(game) || game.result !== "Incomplete");
  }
  return normalized;
}

function battlefieldImageFromEvidencePayload(payload: Record<string, unknown>, side: "me" | "opponent"): string {
  const candidates = Array.isArray(payload.battlefieldCandidates) ? payload.battlefieldCandidates : [];
  const usable: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const image = readUnknownString(record.image);
    if (readUnknownString(record.side) === side && record.hidden !== true && image && !isCardBackImage(image) && !isGeneratedBattlefieldCandidate(record)) {
      usable.push(image);
    }
  }
  const unique = Array.from(new Map(usable.map((image) => [normalizeAssetKey(image), image])).values());
  if (side === "me" && unique.length !== 1) {
    return "";
  }
  if (unique[0]) {
    return unique[0];
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const image = readUnknownString(record.image);
    if (readUnknownString(record.side) === side && image && !isCardBackImage(image) && !isGeneratedBattlefieldCandidate(record)) {
      return image;
    }
  }
  return "";
}

function isGeneratedBattlefieldCandidate(candidate: Record<string, unknown>): boolean {
  return isGeneratedBattlefieldName(readUnknownString(candidate.text) || readUnknownString(candidate.name) || readUnknownString(candidate.code)) ||
    isGeneratedBattlefieldImage(readUnknownString(candidate.image));
}

function isGeneratedBattlefieldName(value: string): boolean {
  return /\bbaron\s+pit\b/i.test(value);
}

function isGeneratedBattlefieldImage(value: string): boolean {
  return /baron[-_\s]?pit|e44f173629322a4e0c32d3f8902c294d4482ef42/i.test(value);
}

function isCardBackImage(value: string): boolean {
  return /cardback|card-back|back-black|back\.png/i.test(value);
}

function normalizeAssetKey(value: string): string {
  return value.trim().toLowerCase().replace(/[?#].*$/, "");
}

function normalizeTextKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function reviewScoreValues(draft: MatchDraft, gameIndex = 0): { me: string; opp: string } {
  const game = draft.games[gameIndex];
  const gameMe = formatReviewScore(game?.myPoints);
  const gameOpp = formatReviewScore(game?.oppPoints);
  if (gameMe || gameOpp) {
    return { me: gameMe, opp: gameOpp };
  }
  if (gameIndex > 0) {
    return { me: "", opp: "" };
  }
  const parsed = parseScoreText(draft.score);
  return {
    me: formatReviewScore(parsed.me),
    opp: formatReviewScore(parsed.opp)
  };
}

function bestReviewGameForBo1(draft: MatchDraft): MatchGame {
  const candidates = [
    ...draft.games,
    ...reviewGamesFromEvidence(draft),
    createReviewGame(draft, 1)
  ].map((game, index) => normalizeReviewGame({ ...game, gameNumber: index + 1 }));
  const best = candidates
    .filter(reviewGameHasData)
    .sort((a, b) => reviewGameQuality(b) - reviewGameQuality(a))[0] ?? normalizeReviewGame(createReviewGame(draft, 1));
  return { ...best, gameNumber: 1 };
}

function reviewGameQuality(game: MatchGame): number {
  let score = 0;
  if (reviewGameHasNonZeroScore(game)) score += 1000;
  if (game.result !== "Incomplete") score += 250;
  if (typeof normalizeOptionalScore(game.myPoints) === "number" && typeof normalizeOptionalScore(game.oppPoints) === "number") score += 150;
  if (game.myBattlefield) score += 40;
  if (game.oppBattlefield) score += 40;
  if (game.myBattlefieldImage) score += 20;
  if (game.oppBattlefieldImage) score += 20;
  if (game.wentFirst) score += 10;
  return score;
}

function draftFromPrimaryReviewGame(draft: MatchDraft, game: MatchGame): Partial<MatchDraft> {
  return {
    myBattlefield: game.myBattlefield || draft.myBattlefield,
    opponentBattlefield: game.oppBattlefield || draft.opponentBattlefield
  };
}

function parseScoreText(score: string): { me?: number; opp?: number } {
  const match = score.match(/^\s*(\d+)\s*[-:]\s*(\d+)/);
  if (!match) {
    return {};
  }
  return {
    me: Number.parseInt(match[1], 10),
    opp: Number.parseInt(match[2], 10)
  };
}

function parseReviewScore(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
}

function normalizeOptionalScore(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string" && value.trim()) {
    return parseReviewScore(value);
  }
  return undefined;
}

function formatReviewScore(value: unknown): string {
  const normalized = normalizeOptionalScore(value);
  return typeof normalized === "number" ? String(normalized) : "";
}

function scoreTextFromGame(game: MatchDraft["games"][number] | undefined): string {
  if (!game) {
    return "";
  }
  return scoreTextFromPoints(normalizeOptionalScore(game.myPoints), normalizeOptionalScore(game.oppPoints));
}

function reviewMatchSummary(games: MatchGame[], fallback: MatchDraft["result"]): { result: MatchDraft["result"]; score: string } {
  const normalized = games.map(normalizeReviewGame);
  const score = reviewMatchScore(normalized);
  if (normalized.length > 1) {
    const wins = normalized.filter((game) => game.result === "Win").length;
    const losses = normalized.filter((game) => game.result === "Loss").length;
    const draws = normalized.filter((game) => game.result === "Draw").length;
    const completed = wins + losses + draws;
    if (wins >= 2) return { result: "Win", score };
    if (losses >= 2) return { result: "Loss", score };
    if (completed === normalized.length) {
      if (wins > losses) return { result: "Win", score };
      if (losses > wins) return { result: "Loss", score };
      return { result: "Draw", score };
    }
    return { result: fallback, score };
  }
  return { result: normalized[0]?.result ?? fallback, score };
}

function reviewMatchScore(games: MatchGame[]): string {
  const wins = games.filter((game) => game.result === "Win").length;
  const losses = games.filter((game) => game.result === "Loss").length;
  const draws = games.filter((game) => game.result === "Draw").length;
  return wins || losses || draws ? `${wins}-${losses}${draws ? `-${draws}` : ""}` : "";
}

function displayMatchRecord(match: MatchDraft): string {
  const games = match.games.length ? match.games.map(normalizeReviewGame) : [];
  const record = reviewMatchScore(games);
  if (record) {
    return record;
  }
  if (match.result === "Win") {
    return "1-0";
  }
  if (match.result === "Loss") {
    return "0-1";
  }
  if (match.result === "Draw") {
    return "0-0-1";
  }
  return match.score.trim();
}

function normalizeWentFirst(value: unknown): MatchDraft["games"][number]["wentFirst"] {
  return value === "1st" || value === "2nd" || value === "undecided" ? value : "";
}

function seatLabel(value: unknown): string {
  if (value === "1st") return "Went 1st";
  if (value === "2nd") return "Went 2nd";
  if (value === "undecided") return "Undecided";
  return "Unknown";
}

function missingSeatGameNumbers(games: MatchGame[]): number[] {
  return games
    .map((game, index) => normalizeWentFirst(game.wentFirst) ? 0 : (game.gameNumber || index + 1))
    .filter((gameNumber) => gameNumber > 0);
}

function seatRequirementMessage(gameNumbers: number[]): string {
  if (!gameNumbers.length) {
    return "";
  }
  if (gameNumbers.length === 1) {
    return gameNumbers[0] === 1 ? "Seat is required before saving." : `Seat is required for game ${gameNumbers[0]}.`;
  }
  return `Seat is required for games ${gameNumbers.join(", ")}.`;
}

function scoreTextFromPoints(myPoints: number | undefined, oppPoints: number | undefined): string {
  if (typeof myPoints !== "number" || typeof oppPoints !== "number") {
    return "";
  }
  return `${myPoints}-${oppPoints}`;
}

function inferReviewResult(myPoints: number | undefined, oppPoints: number | undefined): MatchDraft["result"] {
  if (typeof myPoints !== "number" || typeof oppPoints !== "number") {
    return "Incomplete";
  }
  if (myPoints === 0 && oppPoints === 0) {
    return "Incomplete";
  }
  if (myPoints > oppPoints) return "Win";
  if (oppPoints > myPoints) return "Loss";
  return "Draw";
}

function resultAfterScoreEdit(
  currentResult: MatchGame["result"] | undefined,
  myPoints: number | undefined,
  oppPoints: number | undefined
): MatchGame["result"] {
  const explicitResult = readGameResult(currentResult);
  if (explicitResult && explicitResult !== "Incomplete") {
    return explicitResult;
  }
  return inferReviewResult(myPoints, oppPoints);
}

type CatalogOption = {
  name: string;
  aliases: string[];
};

function BattlefieldInput({ label, value, options, onChange, strict = false }: {
  label: string;
  value: string;
  options: BattlefieldOption[];
  onChange: (value: string) => void;
  strict?: boolean;
}) {
  return (
    <CatalogInput
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      placeholder="Type to search battlefields"
      strict={strict}
    />
  );
}

function ExtraBattlefieldToggles({ value, onChange }: { value?: string[]; onChange: (value: string[]) => void }) {
  const selected = normalizeExtraBattlefields(value);
  return (
    <div className="review-extra-battlefields">
      <span>Extra battlefield</span>
      <div className="review-extra-options">
        {SPECIAL_BATTLEFIELDS.map((name) => (
          <label key={name} className="mini-checkbox">
            <input
              type="checkbox"
              checked={selected.includes(name)}
              onChange={(event) => onChange(nextExtraBattlefields(selected, name, event.target.checked))}
            />
            <span>{name}</span>
          </label>
        ))}
      </div>
      <small>Only saved when ticked. Kept separate from normal battlefield stats.</small>
    </div>
  );
}

function LegendInput({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <CatalogInput
      label={label}
      value={value}
      options={LEGEND_PICKER_OPTIONS}
      onChange={onChange}
      placeholder={placeholder}
      strict
    />
  );
}

function CatalogInput({ label, value, options, onChange, placeholder, strict = false }: {
  label: string;
  value: string;
  options: CatalogOption[];
  onChange: (value: string) => void;
  placeholder: string;
  strict?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const inputValue = strict ? draftValue : value;
  const normalizedValue = catalogSearchKey(inputValue);
  const suggestions = useMemo(() => {
    const query = normalizedValue;
    const source = query
      ? options.filter((option) => catalogOptionMatches(option, query))
      : options;
    return source.slice(0, 8);
  }, [normalizedValue, options]);
  const exactOption = normalizedValue ? findExactCatalogOption(inputValue, options) : null;
  const exactMatch = Boolean(exactOption);
  const open = focused && suggestions.length > 0 && (!exactMatch || suggestions.length > 1);

  useEffect(() => {
    if (!focused) {
      setDraftValue(value);
    }
  }, [focused, value]);

  function commit(option: CatalogOption) {
    setDraftValue(option.name);
    onChange(option.name);
    setFocused(false);
  }

  function handleChange(nextValue: string) {
    if (!strict) {
      onChange(nextValue);
      return;
    }
    setDraftValue(nextValue);
    const exact = findExactCatalogOption(nextValue, options);
    onChange(exact?.name ?? "");
  }

  function handleBlur() {
    window.setTimeout(() => {
      setFocused(false);
      if (!strict) {
        return;
      }
      const exact = findExactCatalogOption(draftValue, options);
      if (exact) {
        onChange(exact.name);
        setDraftValue(exact.name);
      } else {
        setDraftValue(value);
      }
    }, 120);
  }

  return (
    <div className="field-combobox" data-strict={strict ? "true" : "false"}>
      <label>
        <span>{label}</span>
        <input
          value={inputValue}
          data-valid={!strict || !inputValue.trim() || exactMatch ? "true" : "false"}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          onKeyDown={(event) => {
            if (strict && event.key === "Enter" && suggestions[0]) {
              event.preventDefault();
              commit(suggestions[0]);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
        />
      </label>
      {open ? (
        <div className="field-combobox-menu" role="listbox">
          {suggestions.map((option) => (
            <button
              type="button"
              key={option.name}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(option)}
            >
              <strong>{option.name}</strong>
              {option.aliases.length ? <span>{option.aliases.slice(0, 2).join(", ")}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {strict && focused && inputValue.trim() && !exactMatch ? <small className="field-combobox-hint">Select a listed value to save it.</small> : null}
    </div>
  );
}

function catalogOptionMatches(option: CatalogOption, query: string): boolean {
  return [option.name, ...option.aliases].some((candidate) => catalogSearchKey(candidate).includes(query));
}

function findExactCatalogOption(value: string, options: CatalogOption[]): CatalogOption | null {
  const key = catalogSearchKey(value);
  if (!key) {
    return null;
  }
  return options.find((option) => [option.name, ...option.aliases].some((candidate) => catalogSearchKey(candidate) === key)) ?? null;
}

function catalogSearchKey(value: string): string {
  return value.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9]+/g, "");
}

function MatchReviewModal({ draft, decks, battlefields, onClose, onConfirm, onChange }: {
  draft: MatchDraft;
  decks: SavedDeck[];
  battlefields: BattlefieldOption[];
  onClose: () => void;
  onConfirm: (draft: MatchDraft) => Promise<void>;
  onChange: (draft: MatchDraft) => void;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [seatErrorGames, setSeatErrorGames] = useState<number[]>([]);
  const bo3GamesCacheRef = useRef<MatchGame[]>(draft.games.length > 1 ? ensureReviewGames(draft, "Bo3") : []);

  useEffect(() => {
    if (draft.format !== "Bo1" && draft.games.length > 1) {
      bo3GamesCacheRef.current = ensureReviewGames(draft, "Bo3");
    }
  }, [draft.id, draft.format, draft.games]);

  function patch(next: Partial<MatchDraft>) {
    if (saveError) {
      setSaveError("");
    }
    onChange({ ...draft, ...next });
  }

  async function saveMatch() {
    if (isSaving) {
      return;
    }
    setSaveError("");
    const normalizedGames = ensureReviewGames(draft, draft.format);
    const missingSeatGames = missingSeatGameNumbers(normalizedGames);
    if (missingSeatGames.length) {
      setSeatErrorGames(missingSeatGames);
      setSaveError(seatRequirementMessage(missingSeatGames));
      return;
    }
    setSeatErrorGames([]);
    setIsSaving(true);
    try {
      await onConfirm(normalizeReviewDraft(draft));
    } catch {
      setSaveError("Save did not complete. Please try again.");
      setIsSaving(false);
    }
  }

  function patchScore(side: "me" | "opp", value: string) {
    patchGameScore(0, side, value);
  }

  function patchPrimaryGame(next: Partial<MatchDraft["games"][number]>) {
    patchGame(0, next);
  }

  function patchBattlefield(side: "me" | "opp", value: string) {
    patchGame(0, side === "me" ? { myBattlefield: value } : { oppBattlefield: value }, side === "me" ? { myBattlefield: value } : { opponentBattlefield: value });
  }

  function patchMatchResult(result: MatchDraft["result"]) {
    const games = ensureReviewGames(draft, draft.format);
    if (!isMultiGameReview && games[0]) {
      games[0] = normalizeReviewGame({
        ...games[0],
        result,
        gameNumber: 1
      });
      const summary = reviewMatchSummary(games, result);
      patch({
        result,
        games,
        score: summary.score || draft.score
      });
      return;
    }
    patch({ result });
  }

  function patchGameScore(gameIndex: number, side: "me" | "opp", value: string) {
    const currentGame = reviewGames[gameIndex] ?? createReviewGame(draft, gameIndex + 1);
    const current = reviewScoreValues({ ...draft, games: reviewGames }, gameIndex);
    const nextMe = side === "me" ? value : current.me;
    const nextOpp = side === "opp" ? value : current.opp;
    const myPoints = parseReviewScore(nextMe);
    const oppPoints = parseReviewScore(nextOpp);
    patchGame(gameIndex, {
      myPoints,
      oppPoints,
      result: resultAfterScoreEdit(currentGame.result, myPoints, oppPoints)
    });
  }

  function patchGame(gameIndex: number, next: Partial<MatchDraft["games"][number]>, extra: Partial<MatchDraft> = {}) {
    const games = ensureReviewGames(draft, draft.format);
    games[gameIndex] = normalizeReviewGame({
      ...games[gameIndex],
      ...next,
      gameNumber: gameIndex + 1
    });
    if ("wentFirst" in next && normalizeWentFirst(next.wentFirst)) {
      setSeatErrorGames((current) => current.filter((gameNumber) => gameNumber !== gameIndex + 1));
    }
    const summary = reviewMatchSummary(games, draft.result);
    patch({
      games,
      score: summary.score || draft.score,
      result: summary.result,
      ...extra
    });
  }

  function patchFormat(format: MatchDraft["format"]) {
    setSeatErrorGames([]);
    if (format === "Bo1" && draft.games.length > 1) {
      bo3GamesCacheRef.current = ensureReviewGames(draft, "Bo3");
    }
    const cachedBo3Games = bo3GamesCacheRef.current.length > 1 ? bo3GamesCacheRef.current : [];
    const wantsMultiGameFormat = format === "Bo3" || (format === "Auto" && cachedBo3Games.length > 1);
    const evidenceGames = wantsMultiGameFormat ? reviewGamesFromEvidence(draft) : [];
    const sourceDraft = wantsMultiGameFormat && cachedBo3Games.length > draft.games.length
      ? { ...draft, games: cachedBo3Games }
      : evidenceGames.length > draft.games.length
        ? { ...draft, games: evidenceGames }
        : draft;
    const games = format === "Bo1"
      ? [normalizeReviewGame(bestReviewGameForBo1(draft))]
      : ensureReviewGames(sourceDraft, format);
    const summary = reviewMatchSummary(games, draft.result);
    patch({
      format,
      games,
      score: summary.score || draft.score,
      result: summary.result,
      ...draftFromPrimaryReviewGame(draft, games[0] ?? createReviewGame(draft, 1))
    });
  }

  function addBo3Game() {
    const games = ensureReviewGames(draft, "Bo3");
    if (games.length >= 3) {
      return;
    }
    const nextGames = [...games, createReviewGame(draft, games.length + 1)];
    const summary = reviewMatchSummary(nextGames, draft.result);
    patch({ format: "Bo3", games: nextGames, score: summary.score || draft.score, result: summary.result });
  }

  function removeLastBo3Game() {
    const games = ensureReviewGames(draft, "Bo3");
    if (games.length <= 2) {
      return;
    }
    const nextGames = games.slice(0, -1).map((game, index) => ({ ...game, gameNumber: index + 1 }));
    const summary = reviewMatchSummary(nextGames, draft.result);
    patch({ format: "Bo3", games: nextGames, score: summary.score || draft.score, result: summary.result });
  }

  function patchDeckSelection(deckId: string) {
    if (!deckId) {
      patch({
        deckName: "",
        deckSourceId: "",
        deckSourceKey: "",
        deckSourceUrl: "",
        deckSnapshotJson: ""
      });
      return;
    }
    if (deckId === "__current") {
      return;
    }
    const deck = decks.find((item) => item.id === deckId);
    if (!deck) {
      return;
    }
    patch({
      deckName: deck.title,
      deckSourceId: deck.sourceKey || deck.id,
      deckSourceKey: deck.sourceKey,
      deckSourceUrl: deck.sourceUrl,
      deckSnapshotJson: deck.snapshotJson
    });
  }

  const reviewGames = ensureReviewGames(draft, draft.format);
  const scoreValues = reviewScoreValues({ ...draft, games: reviewGames });
  const primaryGame = reviewGames[0] ?? createReviewGame(draft);
  const isMultiGameReview = draft.format === "Bo3" || reviewGames.length > 1;
  const attachedDeck = decks.find((deck) => deck.id === draft.deckSourceId || deck.sourceKey === (draft.deckSourceKey || draft.deckSourceId));
  const deckSelectValue = attachedDeck?.id ?? (draft.deckName ? "__current" : "");
  const bo1SeatInvalid = seatErrorGames.includes(1);
  const isScorepadDraft = draft.source === "scorepad" || draft.source === "manual";

  return (
    <div className="modal-backdrop">
      <section className="review-modal">
        <header>
          <div>
            <h2>{isScorepadDraft ? "Review Scorepad match" : "Review captured match"}</h2>
            <p>{isScorepadDraft ? "Scorepad matches save locally and stay out of public community stats." : "RiftLite captured this automatically. Make corrections before syncing."}</p>
          </div>
          <button className="icon-button" disabled={isSaving} onClick={onClose}>x</button>
        </header>
        <div className="review-grid">
          <label>Result<select value={draft.result} onChange={(event) => patchMatchResult(event.target.value as MatchDraft["result"])}><option>Win</option><option>Loss</option><option>Draw</option><option>Incomplete</option></select></label>
          <label>Format<select value={draft.format} onChange={(event) => patchFormat(event.target.value as MatchDraft["format"])}><option>Bo1</option><option>Bo3</option><option>Auto</option></select></label>
          {!isMultiGameReview ? <label className={`review-field ${bo1SeatInvalid ? "field-invalid" : ""}`}>Seat<select value={primaryGame.wentFirst ?? ""} onChange={(event) => patchPrimaryGame({ wentFirst: normalizeWentFirst(event.target.value) })}><option value="">Unknown</option><option value="1st">Went 1st</option><option value="2nd">Went 2nd</option><option value="undecided">Undecided / no seat</option></select>{bo1SeatInvalid ? <small>Seat is required</small> : null}</label> : null}
          <label>Opponent<input value={draft.opponentName} onChange={(event) => patch({ opponentName: event.target.value })} /></label>
          {!isMultiGameReview ? <div className="score-input-group">
            <label>My score<input type="number" min="0" step="1" value={scoreValues.me} onChange={(event) => patchScore("me", event.target.value)} /></label>
            <label>Opponent score<input type="number" min="0" step="1" value={scoreValues.opp} onChange={(event) => patchScore("opp", event.target.value)} /></label>
          </div> : null}
          <label>My legend<input value={draft.myChampion} onChange={(event) => patch({ myChampion: event.target.value })} /></label>
          <label>Opponent legend<input value={draft.opponentChampion} onChange={(event) => patch({ opponentChampion: event.target.value })} /></label>
          {!isMultiGameReview ? <>
            <BattlefieldInput label="My battlefield" value={draft.myBattlefield} options={battlefields} onChange={(value) => patchBattlefield("me", value)} />
            <BattlefieldInput label="Opponent battlefield" value={draft.opponentBattlefield} options={battlefields} onChange={(value) => patchBattlefield("opp", value)} />
            <ExtraBattlefieldToggles value={primaryGame.extraBattlefields} onChange={(value) => patchPrimaryGame({ extraBattlefields: value })} />
          </> : null}
          {isMultiGameReview ? (
            <section className="review-games-panel wide">
              <div className="review-games-header">
                <div>
                  <h3>Best of 3 games</h3>
                  <p>Each game can have its own score, seat, and battlefield.</p>
                </div>
                <div className="review-games-actions">
                  {reviewGames.length < 3 ? <button type="button" className="secondary" onClick={addBo3Game}>Add game</button> : null}
                  {reviewGames.length > 2 ? <button type="button" className="secondary" onClick={removeLastBo3Game}>Remove game 3</button> : null}
                </div>
              </div>
              <div className="review-games-list">
                {reviewGames.map((game, index) => {
                  const gameScore = reviewScoreValues({ ...draft, games: reviewGames }, index);
                  return (
                    <div className="review-game-card" key={`review-game-${game.gameNumber}`}>
                      <div className="review-game-title">
                        <strong>Game {game.gameNumber}</strong>
                        <span>{scoreTextFromGame(game) || "Score needed"}</span>
                      </div>
                      <label>Result<select value={game.result} onChange={(event) => patchGame(index, { result: event.target.value as MatchGame["result"] })}><option>Win</option><option>Loss</option><option>Draw</option><option>Incomplete</option></select></label>
                      <div className="score-input-group">
                        <label>My score<input type="number" min="0" step="1" value={gameScore.me} onChange={(event) => patchGameScore(index, "me", event.target.value)} /></label>
                        <label>Opponent score<input type="number" min="0" step="1" value={gameScore.opp} onChange={(event) => patchGameScore(index, "opp", event.target.value)} /></label>
                      </div>
                      <label className={`review-field ${seatErrorGames.includes(index + 1) ? "field-invalid" : ""}`}>Seat<select value={game.wentFirst ?? ""} onChange={(event) => patchGame(index, { wentFirst: normalizeWentFirst(event.target.value) })}><option value="">Unknown</option><option value="1st">Went 1st</option><option value="2nd">Went 2nd</option><option value="undecided">Undecided / no seat</option></select>{seatErrorGames.includes(index + 1) ? <small>Seat is required</small> : null}</label>
                      <BattlefieldInput label="My battlefield" value={game.myBattlefield ?? ""} options={battlefields} onChange={(value) => patchGame(index, { myBattlefield: value }, index === 0 ? { myBattlefield: value } : {})} />
                      <BattlefieldInput label="Opponent battlefield" value={game.oppBattlefield ?? ""} options={battlefields} onChange={(value) => patchGame(index, { oppBattlefield: value }, index === 0 ? { opponentBattlefield: value } : {})} />
                      <ExtraBattlefieldToggles value={game.extraBattlefields} onChange={(value) => patchGame(index, { extraBattlefields: value })} />
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
          <label>Deck<select value={deckSelectValue} onChange={(event) => patchDeckSelection(event.target.value)}>
            <option value="">No deck</option>
            {deckSelectValue === "__current" ? <option value="__current">{draft.deckName}</option> : null}
            {decks.map((deck) => <option value={deck.id} key={deck.id}>{deck.title}</option>)}
          </select></label>
          <label>Deck name<input value={draft.deckName} onChange={(event) => patch({ deckName: event.target.value })} placeholder="Optional" /></label>
          <label className="wide">Flags<input value={draft.flags} onChange={(event) => patch({ flags: event.target.value })} placeholder="ladder, tournament, testing" /></label>
          {!isScorepadDraft ? (
            <label className="toggle-row wide review-replay-toggle">
              <span><Images size={16} /> Save replay files for this match</span>
              <input
                type="checkbox"
                checked={draft.keepReplay !== false}
                onChange={(event) => patch({ keepReplay: event.target.checked })}
              />
            </label>
          ) : null}
          <label className="wide">Notes<textarea value={draft.notes} onChange={(event) => patch({ notes: event.target.value })} /></label>
        </div>
        <footer>
          <span className={saveError ? "save-error" : ""}><Flag size={16} /> {saveError || (isScorepadDraft ? "Source: Scorepad - public community sync disabled" : `${draft.rawEvidence.length} evidence events retained - review later keeps this pending`)}</span>
          <button className="secondary" disabled={isSaving} onClick={onClose}>Review later</button>
          <button className="primary" disabled={isSaving} onClick={() => void saveMatch()}><Check size={16} /> {isSaving ? "Saving..." : "Save match"}</button>
        </footer>
      </section>
    </div>
  );
}

function healthLabel(health: CaptureHealth): string {
  if (health.state === "match-detected") return "Match detected";
  if (health.state === "review-needed") return "Review needed";
  if (health.state === "saved") return "Saved";
  if (health.state === "watching") return "Watching";
  if (health.state === "weaker-mode") return "Weaker mode";
  if (health.state === "error") return "Capture issue";
  return "Ready";
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
