export type MicrophoneStreamRequest = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

export interface AcquiredMicrophoneStream {
  stream: MediaStream;
  usedSystemDefaultFallback: boolean;
}

function microphoneErrorName(error: unknown): string {
  if (typeof error === "object" && error && "name" in error) {
    return String((error as { name?: unknown }).name ?? "");
  }
  return "";
}

function microphoneConstraintsWereRejected(error: unknown): boolean {
  return [
    "OverconstrainedError",
    "ConstraintNotSatisfiedError",
    "NotFoundError",
    "DevicesNotFoundError"
  ].includes(microphoneErrorName(error));
}

async function acquireSystemDefaultMicrophone(
  request: MicrophoneStreamRequest,
  preferredConstraints: MediaTrackConstraints
): Promise<MediaStream> {
  try {
    return await request({ audio: preferredConstraints });
  } catch (error) {
    if (!microphoneConstraintsWereRejected(error)) {
      throw error;
    }
    return request({ audio: true });
  }
}

export async function acquireMicrophoneStream(
  request: MicrophoneStreamRequest,
  configuredDeviceId: string,
  preferredConstraints: MediaTrackConstraints
): Promise<AcquiredMicrophoneStream> {
  const deviceId = configuredDeviceId.trim();
  if (!deviceId) {
    return {
      stream: await acquireSystemDefaultMicrophone(request, preferredConstraints),
      usedSystemDefaultFallback: false
    };
  }
  const exactDevice = { deviceId: { exact: deviceId } } satisfies MediaTrackConstraints;
  try {
    return {
      stream: await request({ audio: { ...preferredConstraints, ...exactDevice } }),
      usedSystemDefaultFallback: false
    };
  } catch (error) {
    if (!microphoneConstraintsWereRejected(error)) {
      throw error;
    }
  }
  try {
    return {
      stream: await request({ audio: exactDevice }),
      usedSystemDefaultFallback: false
    };
  } catch (error) {
    if (!microphoneConstraintsWereRejected(error)) {
      throw error;
    }
  }
  return {
    stream: await acquireSystemDefaultMicrophone(request, preferredConstraints),
    usedSystemDefaultFallback: true
  };
}

export function microphoneErrorMessage(error: unknown, fallback: string): string {
  const name = microphoneErrorName(error);
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow RiftLite to use the microphone, then try again.";
  }
  if (["NotFoundError", "DevicesNotFoundError", "OverconstrainedError", "ConstraintNotSatisfiedError"].includes(name)) {
    return "No available microphone was found. Connect or enable one, then try again.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The microphone could not start. It may already be in use by another app.";
  }
  if (name === "AbortError") {
    return "Microphone startup was interrupted. Try again.";
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
