export interface PlayCaptureReadinessInput {
  webEnabled: boolean;
  webCapturing: boolean;
  videoEnabled: boolean;
  videoArmed: boolean;
  videoRecording: boolean;
  microphoneEnabled: boolean;
  microphoneRecording: boolean;
}

export interface PlayCaptureReadinessItem {
  kind: "web" | "video" | "microphone";
  label: string;
  status: string;
  detail: string;
  recording: boolean;
}

/** Actual capture has precedence over preferences, which apply to later games. */
export function playCaptureReadiness(input: PlayCaptureReadinessInput): PlayCaptureReadinessItem[] {
  return [
    {
      kind: "web", label: "Web replay", recording: input.webCapturing,
      status: input.webCapturing ? "Capturing" : input.webEnabled ? "On for new games" : "Off",
      detail: input.webCapturing ? "Interactive game events are being captured." : input.webEnabled ? "Interactive replay capture is enabled for new games." : "Interactive replay capture is off."
    },
    {
      kind: "video", label: "Video", recording: input.videoRecording,
      status: input.videoRecording ? "Recording" : !input.videoEnabled ? "Off" : input.videoArmed ? "Ready" : "Waiting for game",
      detail: input.videoRecording ? "Game video is being recorded on this computer." : !input.videoEnabled ? "Local video recording is off." : input.videoArmed ? "The video source is ready. Recording starts when a match begins." : "Video is enabled. Click inside the game before starting a match to prepare capture."
    },
    {
      kind: "microphone", label: "Mic", recording: input.microphoneRecording,
      status: input.microphoneRecording ? "Recording" : input.microphoneEnabled ? "Next recording" : "Off",
      detail: input.microphoneRecording ? "Microphone audio is included in the current video." : input.microphoneEnabled ? "Microphone is enabled for the next video; it is not recording now." : "Your microphone is not being recorded."
    }
  ];
}
