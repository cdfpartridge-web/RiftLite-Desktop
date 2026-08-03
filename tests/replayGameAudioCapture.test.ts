import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("video replay game audio integration", () => {
  const rendererSource = readFileSync(join(process.cwd(), "src", "renderer", "App.tsx"), "utf8");

  it("requests audio with the prepared direct game-frame stream", () => {
    const prepareSource = rendererSource.match(
      /async function prepareDisplayReplaySource\([\s\S]*?async function prepareSystemWindowReplaySource/
    )?.[0] ?? "";

    expect(prepareSource).not.toBe("");
    expect(prepareSource).toContain("audio: true");
  });

  it("mixes game and microphone tracks into one recorder audio track", () => {
    expect(rendererSource).toContain("composeReplayRecorderStream(stream, displaySource.stream, micStream)");
    expect(rendererSource).toContain("createMediaStreamSource(new MediaStream([gameAudioTrack]))");
    expect(rendererSource).toContain("createMediaStreamSource(new MediaStream([micAudioTrack]))");
    expect(rendererSource).toContain("new MediaStream([...videoTracks, mixedAudioTrack])");
  });

  it("closes the replay audio mixer when recording finishes", () => {
    expect(rendererSource).toContain("await runtime.audioContext?.close().catch(() => undefined)");
  });
});
