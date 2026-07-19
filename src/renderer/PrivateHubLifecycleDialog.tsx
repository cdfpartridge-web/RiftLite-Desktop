import { LogOut, Trash2, X } from "lucide-react";
import type { PrivateHub } from "../shared/types";

export type PrivateHubLifecycleIntent = {
  action: "leave" | "delete";
  hub: Pick<PrivateHub, "id" | "name">;
};

export function PrivateHubLifecycleDialog({
  intent,
  countdown,
  busy,
  error,
  onCancel,
  onConfirm
}: {
  intent: PrivateHubLifecycleIntent;
  countdown: number;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const deleting = intent.action === "delete";
  const waiting = deleting && countdown > 0;
  const titleId = `hub-${intent.action}-confirmation-title`;
  return (
    <div
      className="modal-backdrop hub-lifecycle-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <section className="hub-lifecycle-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div className="hub-lifecycle-heading">
            {deleting ? <Trash2 size={21} /> : <LogOut size={21} />}
            <div>
              <span>{deleting ? "Permanent action" : "Membership"}</span>
              <h2 id={titleId}>{deleting ? `Delete ${intent.hub.name}?` : `Leave ${intent.hub.name}?`}</h2>
            </div>
          </div>
          <button className="icon-button" disabled={busy} aria-label="Cancel" onClick={onCancel}><X size={17} /></button>
        </header>
        <div className="hub-lifecycle-copy">
          <strong>Are you sure?</strong>
          <p>{deleting
            ? "This permanently deletes the private hub, its membership, messages, invites, configuration, and shared hub match data. This cannot be undone."
            : "You will lose access to this private hub and its shared match history. An owner or co-owner will need to invite you again."}</p>
          {deleting ? (
            <div className="hub-delete-countdown" aria-live="polite" data-ready={waiting ? "false" : "true"}>
              {waiting
                ? `Delete unlocks in ${countdown} second${countdown === 1 ? "" : "s"}.`
                : "Countdown complete. Permanent delete is now available."}
            </div>
          ) : null}
          {error ? <p className="hub-lifecycle-error" role="alert">{error}</p> : null}
        </div>
        <footer>
          <button className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="secondary danger" disabled={busy || waiting} onClick={onConfirm}>
            {busy
              ? deleting ? "Deleting hub..." : "Leaving hub..."
              : waiting ? `Delete hub in ${countdown}s`
                : deleting ? "Permanently delete hub" : "Leave private hub"}
          </button>
        </footer>
      </section>
    </div>
  );
}
