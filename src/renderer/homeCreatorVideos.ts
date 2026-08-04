export type HomeFeaturedVideo = {
  title: string;
  embedUrl: string;
  url: string;
  thumbnailUrl?: string;
  videoId: string;
  creatorId?: string;
  creatorName?: string;
  channelUrl?: string;
  publishedAt?: string;
};

export type HomeCreatorVideoCarouselConfig = {
  enabled: boolean;
  rotationSeconds: number;
  maxItems: number;
};

export type HomeCreatorVideoFeed = {
  videos: HomeFeaturedVideo[];
  carousel: HomeCreatorVideoCarouselConfig;
  updatedAt: string;
  source: "creator" | "legacy";
};

export const DEFAULT_HOME_CONFIG_URL = "https://www.riftlite.com/api/app/home";
export const HOME_FEED_REFRESH_MS = 30 * 60 * 1_000;

const DEFAULT_CAROUSEL_CONFIG: HomeCreatorVideoCarouselConfig = {
  enabled: true,
  rotationSeconds: 12,
  maxItems: 14
};

export const DEFAULT_HOME_FEATURED_VIDEOS: HomeFeaturedVideo[] = [
  featuredVideoFromId("4n0x_t-wprg"),
  featuredVideoFromId("gUHFg8zSnSY")
];

export function resolveHomeConfigUrl(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) {
    return DEFAULT_HOME_CONFIG_URL;
  }
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    if (url.protocol === "https:" || (url.protocol === "http:" && isLocalhost)) {
      return url.toString();
    }
  } catch {
    // Use the production endpoint for malformed development overrides.
  }
  return DEFAULT_HOME_CONFIG_URL;
}

export function homeCreatorVideoFeedFromConfig(value: unknown): HomeCreatorVideoFeed {
  const payload = isRecord(value) ? value : {};
  const carousel = homeCreatorVideoCarouselFromConfig(payload.creatorVideoCarousel);
  const creatorVideos = uniqueVideos(readVideoArray(payload.creatorVideos)).slice(0, carousel.maxItems);
  const legacyVideos = uniqueVideos(readLegacyVideos(payload));
  const useCreatorFeed = carousel.enabled && creatorVideos.length > 0;
  const selectedVideos = useCreatorFeed ? creatorVideos : legacyVideos;
  const videos = selectedVideos.length ? selectedVideos : DEFAULT_HOME_FEATURED_VIDEOS;

  return {
    videos: videos.slice(0, carousel.maxItems),
    carousel,
    updatedAt: validDateString(payload.creatorVideosUpdatedAt),
    source: useCreatorFeed ? "creator" : "legacy"
  };
}

export function homeCreatorVideoCarouselFromConfig(value: unknown): HomeCreatorVideoCarouselConfig {
  const config = isRecord(value) ? value : {};
  return {
    enabled: typeof config.enabled === "boolean" ? config.enabled : DEFAULT_CAROUSEL_CONFIG.enabled,
    rotationSeconds: boundedInteger(config.rotationSeconds, DEFAULT_CAROUSEL_CONFIG.rotationSeconds, 5, 120),
    maxItems: boundedInteger(config.maxItems, DEFAULT_CAROUSEL_CONFIG.maxItems, 1, 50)
  };
}

export function nextHomeCreatorVideoIndex(index: number, delta: number, itemCount: number): number {
  if (!Number.isFinite(index) || itemCount <= 0) {
    return 0;
  }
  const normalizedIndex = Math.trunc(index) % itemCount;
  return (normalizedIndex + Math.trunc(delta) + itemCount) % itemCount;
}

export function shouldAutoAdvanceHomeCreatorVideo(input: {
  enabled: boolean;
  explicitlyPaused: boolean;
  interacting: boolean;
  playing: boolean;
  motionAllowed: boolean;
  itemCount: number;
}): boolean {
  return input.enabled
    && !input.explicitlyPaused
    && !input.interacting
    && !input.playing
    && input.motionAllowed
    && input.itemCount > 1;
}

export function homeCreatorVideoDateLabel(value: string | undefined, now = new Date()): string {
  if (!value) {
    return "Featured video";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Featured video";
  }
  const dateDay = date.toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (dateDay === today) {
    return "Today";
  }
  if (dateDay === yesterday) {
    return "Yesterday";
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: date.getUTCFullYear() === now.getUTCFullYear() ? undefined : "numeric" });
}

function readVideoArray(value: unknown): HomeFeaturedVideo[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => isRecord(item) ? homeFeaturedVideoFromRecord(item) : null)
    .filter((item): item is HomeFeaturedVideo => item !== null);
}

function readLegacyVideos(payload: Record<string, unknown>): HomeFeaturedVideo[] {
  const entries = Array.isArray(payload.featuredVideos)
    ? payload.featuredVideos
    : payload.featuredVideo
      ? [payload.featuredVideo]
      : payload.url || payload.embedUrl || payload.videoId
        ? [payload]
        : [];
  return entries
    .map((item) => isRecord(item) ? homeFeaturedVideoFromRecord(item) : null)
    .filter((item): item is HomeFeaturedVideo => item !== null);
}

function homeFeaturedVideoFromRecord(video: Record<string, unknown>): HomeFeaturedVideo | null {
  const rawVideoId = typeof video.videoId === "string" ? video.videoId : "";
  const url = typeof video.url === "string" ? video.url.trim() : "";
  const embedSource = typeof video.embedUrl === "string" ? video.embedUrl.trim() : url;
  const videoId = normalizeYoutubeVideoId(rawVideoId)
    || youtubeVideoIdFromUrl(embedSource)
    || youtubeVideoIdFromUrl(url);
  if (!videoId) {
    return null;
  }

  const thumbnailUrl = safeHttpsUrl(video.thumbnailUrl)
    || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  const result: HomeFeaturedVideo = {
    title: cleanString(video.title) || "Featured RiftLite video",
    embedUrl: youtubeEmbedUrlFromId(videoId),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl,
    videoId
  };
  const creatorId = cleanString(video.creatorId);
  const creatorName = cleanString(video.creatorName);
  const channelUrl = safeYoutubeUrl(video.channelUrl);
  const publishedAt = validDateString(video.publishedAt);
  if (creatorId) result.creatorId = creatorId;
  if (creatorName) result.creatorName = creatorName;
  if (channelUrl) result.channelUrl = channelUrl;
  if (publishedAt) result.publishedAt = publishedAt;
  return result;
}

function uniqueVideos(videos: HomeFeaturedVideo[]): HomeFeaturedVideo[] {
  const seen = new Set<string>();
  return videos.filter((video) => {
    if (seen.has(video.videoId)) {
      return false;
    }
    seen.add(video.videoId);
    return true;
  });
}

function featuredVideoFromId(videoId: string): HomeFeaturedVideo {
  return {
    title: "Featured RiftLite video",
    embedUrl: youtubeEmbedUrlFromId(videoId),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    videoId
  };
}

function normalizeYoutubeVideoId(value: string): string {
  return value.trim().match(/^[A-Za-z0-9_-]{11}$/)?.[0] ?? "";
}

function youtubeVideoIdFromUrl(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return "";
  }
  const directId = normalizeYoutubeVideoId(raw);
  if (directId) {
    return directId;
  }
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      return normalizeYoutubeVideoId(url.pathname.split("/").filter(Boolean)[0] ?? "");
    }
    if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "m.youtube.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      const embedIndex = parts.indexOf("embed");
      const shortsIndex = parts.indexOf("shorts");
      const liveIndex = parts.indexOf("live");
      return normalizeYoutubeVideoId(embedIndex >= 0
        ? parts[embedIndex + 1] ?? ""
        : shortsIndex >= 0
          ? parts[shortsIndex + 1] ?? ""
          : liveIndex >= 0
            ? parts[liveIndex + 1] ?? ""
            : url.searchParams.get("v") ?? "");
    }
  } catch {
    return "";
  }
  return "";
}

function youtubeEmbedUrlFromId(id: string): string {
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    autoplay: "0",
    enablejsapi: "0",
    origin: "https://www.riftlite.com",
    widget_referrer: "https://www.riftlite.com"
  });
  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}

function safeYoutubeUrl(value: unknown): string {
  const raw = cleanString(value);
  if (!raw) {
    return "";
  }
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (url.protocol === "https:" && (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be")) {
      return url.toString();
    }
  } catch {
    return "";
  }
  return "";
}

function safeHttpsUrl(value: unknown): string {
  const raw = cleanString(value);
  if (!raw) {
    return "";
  }
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function validDateString(value: unknown): string {
  const raw = cleanString(value);
  if (!raw || Number.isNaN(new Date(raw).getTime())) {
    return "";
  }
  return raw;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
