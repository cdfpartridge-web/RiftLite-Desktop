export type MediaRecorderStopResult = "already-inactive" | "stopped" | "timed-out";

type StoppableMediaRecorder = Pick<MediaRecorder, "state" | "requestData" | "stop" | "addEventListener" | "removeEventListener">;

export async function stopMediaRecorderSafely(
  recorder: StoppableMediaRecorder,
  options: { requestFinalData?: boolean; timeoutMs?: number } = {}
): Promise<MediaRecorderStopResult> {
  if (recorder.state === "inactive") {
    return "already-inactive";
  }

  const timeoutMs = Math.max(100, options.timeoutMs ?? 4_000);
  return new Promise<MediaRecorderStopResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: MediaRecorderStopResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      recorder.removeEventListener("stop", onStop);
      resolve(result);
    };
    const onStop = () => finish("stopped");

    recorder.addEventListener("stop", onStop, { once: true });
    timer = setTimeout(() => finish("timed-out"), timeoutMs);
    if (options.requestFinalData) {
      try {
        recorder.requestData();
      } catch {
        // A stream can become inactive between the state check and this request.
      }
    }
    try {
      recorder.stop();
    } catch {
      finish(recorder.state === "inactive" ? "already-inactive" : "timed-out");
    }
  });
}
