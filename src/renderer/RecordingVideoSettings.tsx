import { useEffect, useRef, useState } from "react";
import { FolderOpen, Mic, RefreshCw } from "lucide-react";
import type { ReplayFramePreset, ReplayVideoQuality, UserSettings } from "../shared/types";
import "./styles/recording-sharing.css";

export type RecordingVideoSettingsProps = {
  settings: UserSettings;
  onSave: (patch: Partial<UserSettings>) => Promise<void>;
  onChooseReplayDirectory: () => Promise<void>;
  onOpenReplayDirectory: () => Promise<void>;
};

// These choices keep the existing recorder's quality identifiers and profiles.
const VIDEO_QUALITIES: Array<[ReplayVideoQuality, string]> = [
  ["compact", "Compact 540p 12fps — about 350 kbps"],
  ["balanced", "Balanced 720p 24fps — about 900 kbps"],
  ["sharp", "Sharp 1080p 24fps — about 1100 kbps"],
  ["sharp30", "Sharp+ 1080p 30fps — about 2200 kbps"],
  ["youtube", "High quality 1080p 30fps — about 8000 kbps"]
];
const FRAME_PRESETS: Array<[ReplayFramePreset, string]> = [
  ["light", "Light — every 5s — smallest frame bundles"],
  ["standard", "Standard — every 4s — recommended default"],
  ["detailed", "Detailed — every 2s — more frames"]
];

export function RecordingVideoSettings({ settings, onSave, onChooseReplayDirectory, onOpenReplayDirectory }: RecordingVideoSettingsProps) {
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioStatus, setAudioStatus] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [clipHotkey, setClipHotkey] = useState(settings.replayShadowClipHotkey);
  const [flagHotkey, setFlagHotkey] = useState(settings.replayQuickFlagHotkey);
  const active = useRef(true);
  const audioRequest = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; audioRequest.current += 1; }; }, []);
  useEffect(() => { setClipHotkey(settings.replayShadowClipHotkey); }, [settings.replayShadowClipHotkey]);
  useEffect(() => { setFlagHotkey(settings.replayQuickFlagHotkey); }, [settings.replayQuickFlagHotkey]);

  async function refreshMicrophones(requestPermission: boolean) {
    const request = ++audioRequest.current;
    const current = () => active.current && request === audioRequest.current;
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAudioStatus("Microphone device listing is not available on this system.");
      return;
    }
    setAudioBusy(true);
    let stream: MediaStream | null = null;
    try {
      // Permission is requested only by the explicit Refresh microphones action.
      if (requestPermission) stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (current()) { setAudioInputs(devices.filter((device) => device.kind === "audioinput")); setAudioStatus(requestPermission ? "Microphones refreshed." : ""); }
    } catch (cause) { if (current()) setAudioStatus(cause instanceof Error ? cause.message : "Microphone access was blocked."); }
    finally { stream?.getTracks().forEach((track) => track.stop()); if (current()) setAudioBusy(false); }
  }
  useEffect(() => { void refreshMicrophones(false); }, []);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Could not save recording settings."); }
    finally { if (active.current) setBusy(false); }
  }
  const save = (patch: Partial<UserSettings>) => void run(() => onSave(patch));
  function saveShortcut(kind: "clip" | "flag") {
    const value = (kind === "clip" ? clipHotkey : flagHotkey).trim();
    const previous = kind === "clip" ? settings.replayShadowClipHotkey : settings.replayQuickFlagHotkey;
    if (!value) { if (kind === "clip") setClipHotkey(previous); else setFlagHotkey(previous); }
    else if (value !== previous) save(kind === "clip" ? { replayShadowClipHotkey: value } : { replayQuickFlagHotkey: value });
  }
  const clipSeconds = normalizedClipSeconds(settings.replayShadowClipSeconds);
  const guardrail = !settings.replayCaptureEnabled ? "" : settings.replayVideoEnabled && settings.replayVideoQuality === "youtube"
    ? "High quality creates much larger files. Use Sharp 24fps if gameplay starts to feel slow."
    : settings.replayVideoEnabled && settings.replayVideoQuality === "sharp30"
      ? "Sharp+ 30fps is the heaviest replay mode. Use Sharp 24fps if gameplay starts to feel slow."
      : !settings.replayVideoEnabled && settings.replayKeyframesEnabled && settings.replayFramePreset === "detailed"
        ? "Detailed visual frames create more files. Use this when you need extra coaching detail." : "";

  return <div className="recording-video-settings">
    <fieldset disabled={busy} className="recording-video-fields">
      <label className="toggle-row"><span><strong>Record game video</strong><small>Save video with the game's audio when available.</small></span><input type="checkbox" checked={settings.replayCaptureEnabled && settings.replayVideoEnabled} onChange={(event) => save(event.target.checked ? { replayCaptureEnabled: true, replayVideoEnabled: true } : { replayVideoEnabled: false })} /></label>
      <div className="recording-video-grid">
        <label>Video quality<select value={settings.replayVideoQuality} disabled={!settings.replayCaptureEnabled || !settings.replayVideoEnabled} onChange={(event) => save({ replayVideoQuality: event.target.value as ReplayVideoQuality })}>{VIDEO_QUALITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="toggle-row"><span><strong>Include microphone in video</strong><small>Use this preference when the next game video starts.</small></span><input type="checkbox" checked={settings.replayMicAudioEnabled} disabled={!settings.replayCaptureEnabled || !settings.replayVideoEnabled} onChange={(event) => save({ replayMicAudioEnabled: event.target.checked })} /></label>
      </div>
      <label>Microphone<select value={settings.microphoneDeviceId} onChange={(event) => save({ microphoneDeviceId: event.target.value })}><option value="">System default microphone</option>{settings.microphoneDeviceId && !audioInputs.some((device) => device.deviceId === settings.microphoneDeviceId) ? <option value={settings.microphoneDeviceId}>Previously selected microphone (not currently listed)</option> : null}{audioInputs.map((device, index) => <option value={device.deviceId} key={device.deviceId || index}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label>
      <div className="row-actions"><button className="secondary" type="button" disabled={audioBusy} onClick={() => void refreshMicrophones(true)}>{audioBusy ? <RefreshCw size={14} /> : <Mic size={14} />}{audioBusy ? "Checking microphones…" : "Refresh microphones"}</button></div>
      <p className="muted">Microphone preferences and device changes here apply to the next video recording. To mute or unmute a microphone already included in the current recording, use the microphone control in Play. A recording that started without a microphone cannot add one partway through.</p>
      <p className="muted">This device is also used for new voice notes. Refresh microphones may ask for microphone permission; it does not enable recording.</p>
      {audioStatus ? <p className="muted" role="status">{audioStatus}</p> : null}
      <label>Save folder<input readOnly value={settings.replayDirectory || "Default: Documents / RiftLite / Replay Bundles"} /></label>
      <div className="row-actions"><button className="secondary" type="button" onClick={() => void run(onChooseReplayDirectory)}><FolderOpen size={15} />Choose folder</button><button className="secondary" type="button" onClick={() => void run(onOpenReplayDirectory)}>Open folder</button>{settings.replayDirectory ? <button className="secondary" type="button" onClick={() => save({ replayDirectory: "" })}>Use default</button> : null}</div>
      <p className="muted">Video records the embedded Atlas or TCGA game. On Windows, click in the Play screen before queueing so the stream can start. Videos stay on this computer.</p>
      {guardrail ? <div className="settings-note warning">{guardrail}</div> : null}
      <details className="recording-sharing-help"><summary>Advanced: visual frames, clips and shortcuts</summary><div className="recording-video-fields">
        <label className="toggle-row"><span>Local replay capture</span><input type="checkbox" checked={settings.replayCaptureEnabled} onChange={(event) => save({ replayCaptureEnabled: event.target.checked })} /></label>
        <p className="muted">This is the existing master switch for local replay bundles, visual frames and video. It does not change interactive Web Replay upload consent.</p>
        <label className="toggle-row"><span>Timed visual frames</span><input type="checkbox" checked={settings.replayKeyframesEnabled} onChange={(event) => save({ replayKeyframesEnabled: event.target.checked })} /></label>
        <label>Visual frame detail<select value={settings.replayFramePreset} disabled={!settings.replayCaptureEnabled || !settings.replayKeyframesEnabled || settings.replayVideoEnabled} onChange={(event) => save({ replayFramePreset: event.target.value as ReplayFramePreset })}>{FRAME_PRESETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="toggle-row"><span>Save recent video as a clip</span><input type="checkbox" checked={settings.replayShadowClipEnabled} disabled={!settings.replayCaptureEnabled || !settings.replayVideoEnabled} onChange={(event) => save({ replayShadowClipEnabled: event.target.checked })} /></label>
        <p className="muted">Clips reuse the video buffer. The shortcut saves the recent section without starting another recorder.</p>
        <label>Clip length<select value={String(clipSeconds)} disabled={!settings.replayVideoEnabled || !settings.replayShadowClipEnabled} onChange={(event) => save({ replayShadowClipSeconds: normalizedClipSeconds(event.target.value) })}>{![30, 60, 120, 300, 600].includes(clipSeconds) ? <option value={clipSeconds}>{clipSeconds} seconds (current)</option> : null}<option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option><option value="300">5 minutes</option><option value="600">10 minutes</option></select></label>
        <label className="toggle-row"><span>Enable clip shortcut</span><input type="checkbox" checked={settings.replayShadowClipHotkeyEnabled} disabled={!settings.replayVideoEnabled || !settings.replayShadowClipEnabled} onChange={(event) => save({ replayShadowClipHotkeyEnabled: event.target.checked })} /></label>
        <label>Clip shortcut<input value={clipHotkey} disabled={!settings.replayVideoEnabled || !settings.replayShadowClipEnabled || !settings.replayShadowClipHotkeyEnabled} onChange={(event) => setClipHotkey(event.target.value)} onBlur={() => saveShortcut("clip")} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} placeholder="CommandOrControl+Shift+C" /></label>
        <label className="toggle-row"><span>Enable review flag shortcut</span><input type="checkbox" checked={settings.replayQuickFlagHotkeyEnabled} disabled={!settings.replayVideoEnabled && settings.enhancedInsightsEnabled !== true} onChange={(event) => save({ replayQuickFlagHotkeyEnabled: event.target.checked })} /></label>
        <label>Review flag shortcut<input value={flagHotkey} disabled={(!settings.replayVideoEnabled && settings.enhancedInsightsEnabled !== true) || !settings.replayQuickFlagHotkeyEnabled} onChange={(event) => setFlagHotkey(event.target.value)} onBlur={() => saveShortcut("flag")} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} placeholder="CommandOrControl+Shift+F" /></label>
        <p className="muted">Shortcuts use names such as CommandOrControl+Shift+C. With Enhanced Insights, review markers also work without video.</p>
      </div></details>
    </fieldset>
    {error ? <p className="recording-sharing-error" role="alert">{error}</p> : null}
  </div>;
}

function normalizedClipSeconds(value: unknown): number { const numeric = Number(value); return Number.isFinite(numeric) ? Math.max(15, Math.min(600, Math.round(numeric))) : 60; }
