import { describe, expect, it, vi } from "vitest";

import { stopMediaRecorderSafely } from "../src/shared/mediaRecorderStop.js";

describe("MediaRecorder finalization", () => {
  it("does not wait for a stop event that already fired", async () => {
    const recorder = fakeRecorder("inactive");
    await expect(stopMediaRecorderSafely(recorder)).resolves.toBe("already-inactive");
    expect(recorder.stop).not.toHaveBeenCalled();
  });

  it("requests the final chunk and waits for an active recorder to stop", async () => {
    const recorder = fakeRecorder("recording");
    recorder.stop.mockImplementation(() => {
      recorder.state = "inactive";
      recorder.listener?.();
    });
    await expect(stopMediaRecorderSafely(recorder, { requestFinalData: true })).resolves.toBe("stopped");
    expect(recorder.requestData).toHaveBeenCalledOnce();
    expect(recorder.stop).toHaveBeenCalledOnce();
  });

  it("still stops when a final data request races with stream shutdown", async () => {
    const recorder = fakeRecorder("recording");
    recorder.requestData.mockImplementation(() => {
      throw new Error("state changed");
    });
    recorder.stop.mockImplementation(() => {
      recorder.state = "inactive";
      recorder.listener?.();
    });
    await expect(stopMediaRecorderSafely(recorder, { requestFinalData: true })).resolves.toBe("stopped");
    expect(recorder.stop).toHaveBeenCalledOnce();
  });
});

function fakeRecorder(initialState: MediaRecorderState) {
  const recorder = {
    state: initialState,
    listener: undefined as (() => void) | undefined,
    requestData: vi.fn(),
    stop: vi.fn(),
    addEventListener: vi.fn((_kind: string, listener: () => void) => {
      recorder.listener = listener;
    }),
    removeEventListener: vi.fn()
  };
  return recorder;
}
