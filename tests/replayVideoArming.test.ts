import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { gamePlatformForTrustedUrl } from "../src/shared/embeddedContentSecurity";

// Run the production callbacks with controllable media promises. This covers
// navigation and recording races without accessing a profile or capture device.
const source = ts.createSourceFile(
  "App.tsx",
  readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const names = [
  "armReplayVideoSource", "stopArmedReplaySources", "stopReplaySource", "takeArmedReplaySource",
  "maybeStartReplayVideo", "startReplayVideo"
];
const declarations: string[] = [];
function visit(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
    declarations.push(node.getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
if (declarations.length !== names.length) throw new Error("Missing replay arming callbacks");
const compiled = ts.transpileModule(declarations.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;

function mediaSource(kind = "game-frame-direct") {
  const track = { readyState: "live", stop: vi.fn() };
  return {
    source: kind,
    stream: { getVideoTracks: () => [track], getTracks: () => [track] },
    track
  };
}

function harness() {
  let url = "https://play.riftatlas.com/";
  const prepareDisplayReplaySource = vi.fn<(...args: unknown[]) => Promise<ReturnType<typeof mediaSource> | null>>()
    .mockResolvedValue(null);
  const prepareSystemWindowReplaySource = vi.fn().mockResolvedValue(mediaSource("system-window-crop"));
  const armedReplayVideoRef = { current: {} as Record<string, { source: ReturnType<typeof mediaSource> }> };
  const replayVideoArmRequestRef = { current: null as object | null };
  const replayVideoArmGenerationRef = { current: 0 };
  const replayVideoStartPendingRef = { current: false };
  const activeViewRef = { current: "play" };
  const environment = {
    activePlatform: "atlas",
    settingsRef: { current: { replayCaptureEnabled: true, replayVideoEnabled: true, replayVideoQuality: "youtube" } },
    replayVideoRef: { current: null },
    armedReplayVideoRef,
    replayVideoArmRequestRef,
    replayVideoArmGenerationRef,
    replayVideoStartPendingRef,
    activeViewRef,
    gameRef: { current: { getURL: () => url } },
    gamePlatformForTrustedUrl,
    lastReplayArmAttemptRef: { current: 0 },
    REPLAY_VIDEO_ARM_THROTTLE_MS: 7500,
    REPLAY_VIDEO_PROFILES: { youtube: {} },
    prepareDisplayReplaySource,
    prepareSystemWindowReplaySource,
    MediaRecorder: class {},
    replayVideoStartBlockedReason: () => "",
    lastReplayStartEventRef: { current: null },
    composeReplayRecorderStream: async (stream: unknown) => ({ stream }),
    supportedReplayVideoFormats: () => [],
    primeReplayVideoTarget: vi.fn(),
    showActionFeedback: vi.fn(),
    reportReplayVideoDebug: vi.fn()
  };
  const api = new Function(...Object.keys(environment), `${compiled}\nreturn {${names.join(",")}};`)
    (...Object.values(environment)) as {
      armReplayVideoSource(platform?: string): Promise<void>;
      maybeStartReplayVideo(event: unknown): Promise<void>;
      stopArmedReplaySources(): void;
      takeArmedReplaySource(platform: string, mode: string, quality: string): ReturnType<typeof mediaSource> | null;
    };
  return {
    ...api, ...environment,
    navigate(nextUrl: string) { url = nextUrl; }
  };
}

describe("speculative replay video arming", () => {
  it("does not capture the whole app after direct capture fails before a match", async () => {
    const h = harness();
    await h.armReplayVideoSource();
    expect(h.prepareDisplayReplaySource).toHaveBeenCalledTimes(2);
    expect(h.prepareSystemWindowReplaySource).not.toHaveBeenCalled();
    expect(h.armedReplayVideoRef.current.atlas).toBeUndefined();
  });

  it("does not request capture while the guest is on the Atlas deck editor", async () => {
    const h = harness();
    h.navigate("https://riftatlas.com/decks/example");
    await h.armReplayVideoSource();
    expect(h.prepareDisplayReplaySource).not.toHaveBeenCalled();
    expect(h.prepareSystemWindowReplaySource).not.toHaveBeenCalled();
  });

  it("stops a late direct stream after armed sources were cancelled", async () => {
    const h = harness();
    const direct = mediaSource();
    let resolve!: (source: ReturnType<typeof mediaSource>) => void;
    h.prepareDisplayReplaySource.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const pending = h.armReplayVideoSource();
    h.stopArmedReplaySources();
    resolve(direct);
    await pending;
    expect(direct.track.stop).toHaveBeenCalledOnce();
    expect(h.armedReplayVideoRef.current.atlas).toBeUndefined();
  });

  it("stops a pending stream when Play navigates to the deck editor", async () => {
    const h = harness();
    const direct = mediaSource();
    let resolve!: (source: ReturnType<typeof mediaSource>) => void;
    h.prepareDisplayReplaySource.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const pending = h.armReplayVideoSource();
    h.navigate("https://riftatlas.com/decks/example");
    resolve(direct);
    await pending;
    expect(direct.track.stop).toHaveBeenCalledOnce();
    expect(h.armedReplayVideoRef.current.atlas).toBeUndefined();
    expect(h.prepareSystemWindowReplaySource).not.toHaveBeenCalled();
  });

  it("does not arm a stream after a match starts acquiring its recording source", async () => {
    const h = harness();
    const direct = mediaSource();
    let resolve!: (source: ReturnType<typeof mediaSource>) => void;
    h.prepareDisplayReplaySource.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const pending = h.armReplayVideoSource();
    h.replayVideoStartPendingRef.current = true;
    resolve(direct);
    await pending;
    expect(direct.track.stop).toHaveBeenCalledOnce();
    expect(h.armedReplayVideoRef.current.atlas).toBeUndefined();
  });

  it("keeps one prearm request in flight even when the focus throttle expires", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    try {
      const h = harness();
      const direct = mediaSource();
      let resolve!: (source: ReturnType<typeof mediaSource>) => void;
      h.prepareDisplayReplaySource.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
      const pending = h.armReplayVideoSource();
      now.mockReturnValue(20_000);
      await h.armReplayVideoSource();
      expect(h.prepareDisplayReplaySource).toHaveBeenCalledOnce();
      resolve(direct);
      await pending;
      expect(h.armedReplayVideoRef.current.atlas.source).toBe(direct);
    } finally {
      now.mockRestore();
    }
  });

  it("retains a successful direct stream for the first match without requesting it twice", async () => {
    const h = harness();
    const direct = mediaSource();
    h.prepareDisplayReplaySource.mockResolvedValue(direct);
    await h.armReplayVideoSource();
    expect(h.takeArmedReplaySource("atlas", "game-frame", "youtube")).toBe(direct);
    expect(h.armedReplayVideoRef.current.atlas).toBeUndefined();
    expect(direct.track.stop).not.toHaveBeenCalled();
  });

  it("retries direct capture at match start after a speculative failure", async () => {
    const h = harness();
    await h.armReplayVideoSource();
    h.prepareDisplayReplaySource.mockResolvedValueOnce(mediaSource());
    await h.maybeStartReplayVideo({ kind: "match-start", platform: "atlas", payload: {} });
    expect(h.prepareDisplayReplaySource).toHaveBeenCalledTimes(3);
    expect(h.prepareSystemWindowReplaySource).not.toHaveBeenCalled();
  });

  it("reuses the armed direct stream at match start without another acquisition", async () => {
    const h = harness();
    h.prepareDisplayReplaySource.mockResolvedValueOnce(mediaSource());
    await h.armReplayVideoSource();
    await h.maybeStartReplayVideo({ kind: "match-start", platform: "atlas", payload: {} });
    expect(h.prepareDisplayReplaySource).toHaveBeenCalledOnce();
    expect(h.prepareSystemWindowReplaySource).not.toHaveBeenCalled();
    expect(h.armedReplayVideoRef.current.atlas).toBeUndefined();
  });

  it("preserves the window fallback when direct capture fails at actual match start", async () => {
    const h = harness();
    h.prepareSystemWindowReplaySource.mockResolvedValue(null);
    await h.maybeStartReplayVideo({ kind: "match-start", platform: "atlas", payload: {} });
    expect(h.prepareDisplayReplaySource).toHaveBeenCalledOnce();
    expect(h.prepareSystemWindowReplaySource).toHaveBeenCalledOnce();
    expect(h.replayVideoStartPendingRef.current).toBe(false);
  });

  it("does not create competing capture requests for duplicate match-start signals", async () => {
    const h = harness();
    h.prepareSystemWindowReplaySource.mockResolvedValue(null);
    let resolve!: (value: null) => void;
    h.prepareDisplayReplaySource.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const event = { kind: "match-start", platform: "atlas", payload: {} };
    const pending = h.maybeStartReplayVideo(event);
    await h.maybeStartReplayVideo(event);
    await h.armReplayVideoSource();
    expect(h.prepareDisplayReplaySource).toHaveBeenCalledOnce();
    resolve(null);
    await pending;
    expect(h.replayVideoStartPendingRef.current).toBe(false);
  });
});
