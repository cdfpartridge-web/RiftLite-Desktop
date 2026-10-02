import React from "react";
import { Cloud, Film, Mic } from "lucide-react";
import { playCaptureReadiness, type PlayCaptureReadinessInput } from "../shared/playCaptureReadiness";
import "./GameReplayAssets.css";

export function PlayCaptureStatus({ onOpenSetup, ...input }: PlayCaptureReadinessInput & { onOpenSetup: () => void }) {
  return <div className="play-capture-status" aria-label="Recording status">
    {playCaptureReadiness(input).map((item) => {
      const Icon = item.kind === "web" ? Cloud : item.kind === "video" ? Film : Mic;
      const compactStatus = item.status === "On for new games" ? "Enabled" : item.status === "Waiting for game" ? "Waiting" : item.status === "Next recording" ? "Next" : item.status;
      return <button key={item.kind} type="button" onClick={onOpenSetup} data-recording={item.recording} aria-label={`${item.label}: ${item.status}. ${item.detail} Open Recording & sharing.`} title={`${item.label}: ${item.status}. ${item.detail} Open Recording & sharing.`}>
        <Icon size={13} aria-hidden="true" /><span className="play-capture-full" aria-hidden="true">{item.label}: <strong>{item.status}</strong></span><strong className="play-capture-compact" aria-hidden="true">{compactStatus}</strong>
      </button>;
    })}
  </div>;
}
