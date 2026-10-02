import type { RendererCrashFault } from "../shared/types";

let installed = false;
let reporting = false;
let lastWindow = 0;
let reportsInWindow = 0;

export function reportRendererCrash(kind: RendererCrashFault["kind"], error: unknown, location: Partial<RendererCrashFault> = {}): void {
  if (reporting) return;
  reporting = true;
  try {
    const now = Date.now();
    if (now - lastWindow >= 60_000) { lastWindow = now; reportsInWindow = 0; }
    if (reportsInWindow >= 20) return;
    reportsInWindow += 1;
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unhandled renderer error";
    window.riftlite?.reportRendererFault?.({ kind, message: message.slice(0, 2_000),
      stack: error instanceof Error ? error.stack?.slice(0, 6_000) : undefined,
      source: typeof location.source === "string" ? location.source.slice(0, 1_000) : undefined,
      line: location.line, column: location.column });
  } catch {
    // A missing or damaged bridge must not trigger another renderer failure.
  } finally { reporting = false; }
}

export function installRendererCrashLogging(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    reportRendererCrash("error", event.error || event.message, { source: event.filename, line: event.lineno, column: event.colno });
  });
  window.addEventListener("unhandledrejection", (event) => reportRendererCrash("unhandled-rejection", event.reason));
}
