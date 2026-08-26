import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Clipboard, Download, Image as ImageIcon, X } from "lucide-react";
import { CoachQuestCard, type CoachQuestViewModel } from "./CoachQuestCard";

const SHARE_WIDTH = 1200;
const SHARE_HEIGHT = 675;

export function CoachShareCardDialog({
  quest,
  caption,
  onClose
}: {
  quest: CoachQuestViewModel;
  caption: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef<"copy" | "save" | "caption" | null>(null);
  const [scale, setScale] = useState(0.72);
  const [busy, setBusy] = useState<"copy" | "save" | "caption" | null>(null);
  const [message, setMessage] = useState("");
  const titleId = "coach-share-card-title";
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const updateScale = () => {
      const widthScale = Math.max(320, window.innerWidth - 72) / SHARE_WIDTH;
      const heightScale = Math.max(180, window.innerHeight - 230) / SHARE_HEIGHT;
      setScale(Math.min(1, widthScale, heightScale));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) closeRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  async function capture(action: "copy" | "save") {
    const preview = previewRef.current;
    if (!preview || busy) return;
    setBusy(action);
    setMessage("");
    try {
      await settleShareSurface(preview);
      const rect = preview.getBoundingClientRect();
      const left = Math.floor(rect.left);
      const top = Math.floor(rect.top);
      const right = Math.ceil(rect.right);
      const bottom = Math.ceil(rect.bottom);
      const result = await window.riftlite.captureCoachShareCard({
        action,
        bounds: { x: left, y: top, width: right - left, height: bottom - top },
        label: `Coach-${quest.title}`
      });
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The coaching card could not be captured.");
    } finally {
      setBusy(null);
    }
  }

  async function copyCaption() {
    if (busy) return;
    setBusy("caption");
    setMessage("");
    try {
      await window.riftlite.writeClipboardText(caption);
      setMessage("Post text copied.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The post text could not be copied.");
    } finally {
      setBusy(null);
    }
  }

  const dialog = (
    <div
      className="modal-backdrop coach-share-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="coach-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={Boolean(busy)}
        onKeyDown={(event) => trapDialogFocus(event, dialogRef.current)}
      >
        <header className="coach-share-dialog__header">
          <div>
            <span><ImageIcon size={15} /> Share your lesson</span>
            <h2 id={titleId}>Coach card preview</h2>
            <p>Only the lesson, game data and card art are included. Everything is rendered and saved locally.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close share preview" disabled={Boolean(busy)} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="coach-share-stage" style={{ width: SHARE_WIDTH * scale, height: SHARE_HEIGHT * scale }}>
          <div ref={previewRef} className="coach-share-surface" style={{ transform: `scale(${scale})` }}>
            <CoachQuestCard quest={quest} mode="share-preview" />
          </div>
        </div>

        <footer className="coach-share-dialog__footer">
          <p aria-live="polite">{message ? <><Check size={14} /> {message}</> : "1200 × 675 PNG · ready for Discord, X and Bluesky"}</p>
          <div>
            <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void copyCaption()}>
              <Clipboard size={14} /> {busy === "caption" ? "Copying…" : "Copy post text"}
            </button>
            <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => void capture("save")}>
              <Download size={14} /> {busy === "save" ? "Saving…" : "Save PNG"}
            </button>
            <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => void capture("copy")}>
              <ImageIcon size={14} /> {busy === "copy" ? "Copying…" : "Copy image"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}

async function settleShareSurface(surface: HTMLElement): Promise<void> {
  if ("fonts" in document) await document.fonts.ready;
  const images = [...surface.querySelectorAll("img")];
  await Promise.all(images.map(async (image) => {
    if (!image.complete) {
      await new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    }
    try {
      await image.decode();
    } catch {
      // The card swaps failed images for a deterministic initials treatment.
    }
  }));
  await nextFrame();
  await nextFrame();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function trapDialogFocus(event: React.KeyboardEvent<HTMLElement>, dialog: HTMLElement | null) {
  if (event.key !== "Tab") return;
  const focusable = [...(dialog?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
}
