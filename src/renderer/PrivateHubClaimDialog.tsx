import { useEffect, useRef } from "react";
import { Shield, X } from "lucide-react";
import type { PrivateHub } from "../shared/types";

export type PrivateHubClaimIntent = {
  hub: Pick<PrivateHub, "id" | "name">;
};

export function PrivateHubClaimDialog({
  intent,
  password,
  busy,
  error,
  onPasswordChange,
  onCancel,
  onConfirm
}: {
  intent: PrivateHubClaimIntent;
  password: string;
  busy: boolean;
  error?: string;
  onPasswordChange: (password: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(busy);
  const cancelRef = useRef(onCancel);
  const titleId = "hub-claim-title";
  const descriptionId = "hub-claim-description";
  const errorId = "hub-claim-error";
  const passwordReady = Boolean(password.trim());
  busyRef.current = busy;
  cancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => passwordRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) cancelRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop hub-lifecycle-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        ref={dialogRef}
        className="hub-lifecycle-modal hub-claim-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
          ) ?? [])];
          if (!focusable.length) return;
          const first = focusable[0]!;
          const last = focusable.at(-1)!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && passwordReady) onConfirm();
        }}
      >
        <header>
          <div className="hub-lifecycle-heading">
            <Shield size={21} />
            <div>
              <span>Legacy hub ownership</span>
              <h2 id={titleId}>Claim {intent.hub.name}</h2>
            </div>
          </div>
          <button type="button" className="icon-button" disabled={busy} aria-label="Cancel" onClick={onCancel}>
            <X size={17} />
          </button>
        </header>
        <div className="hub-lifecycle-copy hub-claim-copy">
          <p id={descriptionId}>
            Enter the hub&apos;s existing password to connect its ownership and member tools to your signed-in RiftLite account.
          </p>
          <label htmlFor="hub-claim-password">
            Hub password
            <input
              ref={passwordRef}
              id="hub-claim-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              value={password}
              disabled={busy}
              onChange={(event) => onPasswordChange(event.target.value)}
            />
          </label>
          <small>The password is used only to verify ownership of this legacy hub.</small>
          {error ? <p id={errorId} className="hub-claim-error" role="alert">{error}</p> : null}
        </div>
        <footer>
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || !passwordReady}>
            {busy ? "Claiming hub..." : "Claim hub"}
          </button>
        </footer>
      </form>
    </div>
  );
}
