import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Clipboard, Download, Image as ImageIcon, X } from "lucide-react";
import "./styles/coachQuest.css";

const SHARE_WIDTH = 1200;
const SHARE_HEIGHT = 675;

export function ShareCardDialog({
  eyebrow,
  title,
  description,
  label,
  caption,
  captureErrorMessage,
  children,
  onClose
}: {
  eyebrow: string;
  title: string;
  description: string;
  label: string;
  caption: string;
  captureErrorMessage: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef<"copy" | "save" | "caption" | null>(null);
  const [scale, setScale] = useState(0.72);
  const [busy, setBusy] = useState<"copy" | "save" | "caption" | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; tone: "success" | "neutral" | "error" } | null>(null);
  const titleId = useId();
  const descriptionId = useId();
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
    setFeedback(null);
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
        label
      });
      setFeedback({
        message: action === "copy" && result.ok
          ? "Image copied — paste it into X, Discord, or anywhere else."
          : result.message,
        tone: result.ok ? "success" : result.cancelled ? "neutral" : "error"
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : captureErrorMessage,
        tone: "error"
      });
    } finally {
      setBusy(null);
    }
  }

  async function copyCaption() {
    if (busy) return;
    setBusy("caption");
    setFeedback(null);
    try {
      const copied = await window.riftlite.writeClipboardText(caption);
      if (!copied) throw new Error("The post text could not be copied.");
      setFeedback({ message: "Post text copied.", tone: "success" });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The post text could not be copied.",
        tone: "error"
      });
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
        aria-describedby={descriptionId}
        aria-busy={Boolean(busy)}
        onKeyDown={(event) => trapDialogFocus(event, dialogRef.current)}
      >
        <header className="coach-share-dialog__header">
          <div>
            <span><ImageIcon size={15} /> {eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close share preview" disabled={Boolean(busy)} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="coach-share-stage" style={{ width: SHARE_WIDTH * scale, height: SHARE_HEIGHT * scale }}>
          <div ref={previewRef} className="coach-share-surface" style={{ transform: `scale(${scale})` }}>
            {children}
          </div>
        </div>

        <footer className="coach-share-dialog__footer">
          <p
            aria-live="polite"
            role={feedback?.tone === "error" ? "alert" : "status"}
            data-tone={feedback?.tone}
          >
            {feedback ? <>
              {feedback.tone === "error" ? <AlertTriangle size={14} /> : feedback.tone === "success" ? <Check size={14} /> : null}
              {feedback.message}
            </> : "1200 × 675 PNG · ready for Discord, X and Bluesky"}
          </p>
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
  for (let pass = 0; pass < 6; pass += 1) {
    const images = [...surface.querySelectorAll("img")];
    await Promise.all(images.map(settleShareImage));
    await nextFrame();
    const settledImages = [...surface.querySelectorAll("img")];
    if (
      settledImages.length === images.length &&
      settledImages.every((image, index) => image === images[index] && image.complete)
    ) {
      break;
    }
  }
  await nextFrame();
}

async function settleShareImage(image: HTMLImageElement): Promise<void> {
  if (!image.complete) {
    await new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }
  try {
    await image.decode();
  } catch {
    // Share surfaces replace failed images with deterministic local fallbacks.
  }
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
