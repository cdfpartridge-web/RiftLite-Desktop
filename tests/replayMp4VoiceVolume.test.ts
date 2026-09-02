import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_REPLAY_MP4_VOICE_VOLUME,
  MAX_REPLAY_MP4_VOICE_VOLUME,
  MIN_REPLAY_MP4_VOICE_VOLUME,
  normalizeReplayMp4VoiceVolume
} from "../src/shared/replayMp4VoiceVolume";

const mainSource = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../src/renderer/styles/app.css", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("../src/shared/types.ts", import.meta.url), "utf8");

describe("replay MP4 coaching-note volume", () => {
  it("uses an audible default and clamps untrusted renderer input", () => {
    expect(normalizeReplayMp4VoiceVolume(undefined)).toBe(DEFAULT_REPLAY_MP4_VOICE_VOLUME);
    expect(normalizeReplayMp4VoiceVolume("2.25")).toBe(2.25);
    expect(normalizeReplayMp4VoiceVolume("2.25;volume=99")).toBe(DEFAULT_REPLAY_MP4_VOICE_VOLUME);
    expect(normalizeReplayMp4VoiceVolume(0)).toBe(MIN_REPLAY_MP4_VOICE_VOLUME);
    expect(normalizeReplayMp4VoiceVolume(99)).toBe(MAX_REPLAY_MP4_VOICE_VOLUME);
  });

  it("does not let FFmpeg attenuate notes according to the number of delayed inputs", () => {
    const start = mainSource.indexOf("function appendReplayMp4AudioFilters");
    const end = mainSource.indexOf("async function exportReplayMp4", start);
    const audioFilters = mainSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(audioFilters).toContain("normalizeReplayMp4VoiceVolume(options.voiceNoteVolume)");
    expect(audioFilters).toContain("volume=${voiceNoteVolume.toFixed(2)}");
    expect(audioFilters).toContain("normalize=0");
    expect(audioFilters).toContain("alimiter=limit=0.95:level=false:latency=true");
    expect(audioFilters).not.toContain("volume=1.0");
  });

  it("exposes and locally remembers an export-only coaching volume slider", () => {
    expect(typesSource).toContain("voiceNoteVolume?: number");
    expect(appSource).toContain("Coaching note volume (MP4)");
    expect(appSource).toContain("Only affects the exported MP4. Your saved notes are unchanged.");
    expect(appSource).toContain("aria-valuetext={`${Math.round(normalizeReplayMp4VoiceVolume(options.voiceNoteVolume) * 100)}%`}");
    expect(appSource).toContain("writeReplayMp4VoiceVolume(voiceNoteVolume)");
    expect(styleSource).toContain(".replay-export-checks .replay-export-voice-volume");
  });
});
