import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, Download, FolderOpen, RefreshCw } from "lucide-react";
import type { CrashDiagnosticsStatus } from "../shared/crashDiagnostics";
import "./styles/crash-diagnostics.css";

export type CrashDiagnosticsPanelApi = {
  getCrashDiagnosticsStatus(): Promise<CrashDiagnosticsStatus>;
  exportCrashDiagnostics(): Promise<string | null>;
  openCrashDiagnosticsFolder(): Promise<void>;
};

export function CrashDiagnosticsPanel({ api = window.riftlite }: { api?: CrashDiagnosticsPanelApi }) {
  const [status, setStatus] = useState<CrashDiagnosticsStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<"export" | "folder" | null>(null);
  const [statusError, setStatusError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [exportPath, setExportPath] = useState("");
  const mounted = useRef(false);
  const request = useRef(0);
  const actionInProgress = useRef(false);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    setChecking(true);
    setStatusError("");
    try {
      const next = await api.getCrashDiagnosticsStatus();
      if (mounted.current && current === request.current) setStatus(next);
    } catch (cause) {
      if (mounted.current && current === request.current) {
        setStatusError(cause instanceof Error ? cause.message : "Could not check the local crash logs.");
      }
    } finally {
      if (mounted.current && current === request.current) setChecking(false);
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; request.current += 1; };
  }, [refresh]);

  async function runAction(action: "export" | "folder") {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setBusy(action);
    setActionError("");
    setNotice("");
    try {
      if (action === "export") {
        setExportPath("");
        const path = await api.exportCrashDiagnostics();
        if (!mounted.current) return;
        setExportPath(path || "");
        setNotice(path ? "Crash log exported. You can attach this file to your support report." : "Export cancelled.");
      } else {
        await api.openCrashDiagnosticsFolder();
      }
    } catch (cause) {
      if (mounted.current) setActionError(cause instanceof Error ? cause.message : action === "export" ? "Could not export the crash log." : "Could not open the logs folder.");
    } finally {
      actionInProgress.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  const unavailable = Boolean(statusError || status?.lastWriteError || status && !status.enabled);
  const previousTime = status?.previousSession?.lastEventAt || status?.previousSession?.startedAt;
  const previousDate = previousTime ? new Date(previousTime) : null;
  const previousDateLabel = previousDate && Number.isFinite(previousDate.getTime()) ? previousDate.toLocaleString() : "";

  return <section className="rail-card crash-diagnostics-card" aria-labelledby="crash-diagnostics-title">
    <h2 id="crash-diagnostics-title">Crash diagnostics</h2>
    <p className="muted">RiftLite automatically saves diagnostic logs on this computer. If the app closes unexpectedly, reopen it and export the crash log here.</p>
    <div className="crash-diagnostics-health" data-state={unavailable ? "attention" : status?.enabled ? "ready" : "checking"} role="status">
      {unavailable ? <AlertTriangle size={19} aria-hidden="true" /> : <Activity size={19} aria-hidden="true" />}
      <div>
        <strong>{checking ? "Checking local logs…" : unavailable ? "Local logging needs attention" : status?.enabled ? "Automatic logging on" : "Local log status unavailable"}</strong>
        <span>{checking ? "Checking this session's saved diagnostics." : statusError ? "Use Refresh to check again. You can still try exporting the saved logs." : status?.enabled && !status.lastWriteError ? "Logs are saved as you use RiftLite. No setup is needed." : "RiftLite could not confirm that new logs are being saved."}</span>
      </div>
    </div>
    {status?.previousExit === "unexpected" ? <div className="settings-note warning crash-diagnostics-previous">
      <strong>The previous session ended unexpectedly.</strong>
      <p>{previousDateLabel ? `Last activity: ${previousDateLabel}. ` : ""}This can follow a crash, forced close or power loss. Export the log to help investigate.</p>
    </div> : null}
    {statusError || status?.lastWriteError ? <p className="settings-note warning" role="alert">{statusError || status?.lastWriteError}</p> : null}
    <div className="row-actions crash-diagnostics-actions">
      <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => void runAction("export")}><Download size={16} aria-hidden="true" />{busy === "export" ? "Exporting…" : "Export crash log"}</button>
      <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void runAction("folder")}><FolderOpen size={16} aria-hidden="true" />{busy === "folder" ? "Opening…" : "Open logs folder"}</button>
      <button type="button" className="secondary" disabled={checking || Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />{checking ? "Checking…" : "Refresh"}</button>
    </div>
    <p className="muted crash-diagnostics-privacy">Logs stay on this computer and are not uploaded automatically. Export includes text diagnostics; native memory dumps are not included.</p>
    {notice ? <p className="crash-diagnostics-notice" role="status">{notice}</p> : null}
    {exportPath ? <code className="crash-diagnostics-export-path">{exportPath}</code> : null}
    {actionError ? <p className="settings-note warning" role="alert">{actionError}</p> : null}
  </section>;
}
