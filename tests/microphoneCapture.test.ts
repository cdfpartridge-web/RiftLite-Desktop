import { describe, expect, it, vi } from "vitest";

import { acquireMicrophoneStream, microphoneErrorMessage } from "../src/shared/microphoneCapture.js";

const preferredConstraints: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  channelCount: 1
};

describe("microphone capture", () => {
  it("falls back to the system default when a configured exact device is unavailable", async () => {
    const fallbackStream = {} as MediaStream;
    const request = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Requested device not found"), { name: "OverconstrainedError" }))
      .mockRejectedValueOnce(Object.assign(new Error("Requested device not found"), { name: "NotFoundError" }))
      .mockResolvedValueOnce(fallbackStream);

    await expect(acquireMicrophoneStream(request, "stale-device", preferredConstraints)).resolves.toEqual({
      stream: fallbackStream,
      usedSystemDefaultFallback: true
    });
    expect(request).toHaveBeenNthCalledWith(1, {
      audio: { ...preferredConstraints, deviceId: { exact: "stale-device" } }
    });
    expect(request).toHaveBeenNthCalledWith(2, { audio: { deviceId: { exact: "stale-device" } } });
    expect(request).toHaveBeenNthCalledWith(3, { audio: preferredConstraints });
  });

  it("does not issue a second request after microphone permission is denied", async () => {
    const denied = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
    const request = vi.fn().mockRejectedValue(denied);

    await expect(acquireMicrophoneStream(request, "configured-device", preferredConstraints)).rejects.toBe(denied);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps a working configured microphone without falling back", async () => {
    const configuredStream = {} as MediaStream;
    const request = vi.fn().mockResolvedValue(configuredStream);

    await expect(acquireMicrophoneStream(request, "configured-device", preferredConstraints)).resolves.toEqual({
      stream: configuredStream,
      usedSystemDefaultFallback: false
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("relaxes preferred constraints while preserving a working configured device", async () => {
    const configuredStream = {} as MediaStream;
    const request = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Unsupported constraints"), { name: "OverconstrainedError" }))
      .mockResolvedValueOnce(configuredStream);

    await expect(acquireMicrophoneStream(request, "configured-device", preferredConstraints)).resolves.toEqual({
      stream: configuredStream,
      usedSystemDefaultFallback: false
    });
    expect(request).toHaveBeenNthCalledWith(2, { audio: { deviceId: { exact: "configured-device" } } });
  });

  it("uses relaxed default constraints when preferred system-default constraints fail", async () => {
    const fallbackStream = {} as MediaStream;
    const request = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("Unsupported constraints"), { name: "OverconstrainedError" }))
      .mockResolvedValueOnce(fallbackStream);

    await expect(acquireMicrophoneStream(request, "", preferredConstraints)).resolves.toEqual({
      stream: fallbackStream,
      usedSystemDefaultFallback: false
    });
    expect(request).toHaveBeenNthCalledWith(1, { audio: preferredConstraints });
    expect(request).toHaveBeenNthCalledWith(2, { audio: true });
  });

  it("does not silently switch devices when the selected microphone is busy", async () => {
    const busy = Object.assign(new Error("Could not start audio source"), { name: "NotReadableError" });
    const request = vi.fn().mockRejectedValue(busy);

    await expect(acquireMicrophoneStream(request, "configured-device", preferredConstraints)).rejects.toBe(busy);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("maps microphone failures to actionable messages", () => {
    expect(microphoneErrorMessage({ name: "NotAllowedError" }, "fallback")).toContain("access is blocked");
    expect(microphoneErrorMessage({ name: "NotFoundError" }, "fallback")).toContain("No available microphone");
    expect(microphoneErrorMessage({ name: "NotReadableError" }, "fallback")).toContain("already be in use");
    expect(microphoneErrorMessage({ name: "AbortError" }, "fallback")).toContain("interrupted");
    expect(microphoneErrorMessage(new Error("Specific failure"), "fallback")).toBe("Specific failure");
    expect(microphoneErrorMessage(null, "fallback")).toBe("fallback");
  });
});
