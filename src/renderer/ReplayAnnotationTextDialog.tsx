import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Type, X } from "lucide-react";

export function ReplayAnnotationTextDialog({
  targetLabel,
  value,
  onChange,
  onCancel,
  onConfirm
}: {
  targetLabel: string;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(onCancel);
  const titleId = "replay-annotation-text-title";
  const descriptionId = "replay-annotation-text-description";
  const textReady = Boolean(value.trim());
  cancelRef.current = onCancel;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  const dialog = (
    <div
      className="modal-backdrop replay-annotation-text-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        ref={dialogRef}
        className="rail-card replay-flag-editor replay-annotation-text-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
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
          if (textReady) onConfirm();
        }}
      >
        <header>
          <div>
            <h2 id={titleId}><Type size={18} /> Add text annotation</h2>
            <span>{targetLabel}</span>
          </div>
          <button type="button" className="icon-button" aria-label="Cancel text annotation" onClick={onCancel}>
            <X size={16} />
          </button>
        </header>
        <p id={descriptionId} className="muted">
          Enter the label to place at the point you selected. Press Enter to add it or Escape to cancel.
        </p>
        <label htmlFor="replay-annotation-text">
          Annotation text
          <input
            ref={inputRef}
            id="replay-annotation-text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoComplete="off"
            placeholder="What should the viewer notice?"
          />
        </label>
        <div className="row-actions replay-annotation-text-actions">
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={!textReady}>Add annotation</button>
        </div>
      </form>
    </div>
  );

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
