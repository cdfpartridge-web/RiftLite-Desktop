import { app } from "electron";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CaptureDiagnosticsSummary, CaptureEvent, CapturePlatformEvidence, GamePlatform } from "../../shared/types.js";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const ROTATE_CHECK_BYTES = 512 * 1024;
const ROTATE_CHECK_MS = 30_000;

export class CaptureDiagnostics {
  private ensured = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private bytesSinceRotateCheck = 0;
  private nextRotateCheckAt = 0;

  constructor(private readonly filePath = join(app.getPath("userData"), "riftlite-capture-events.jsonl")) {}

  getPath(): string {
    return this.filePath;
  }

  async ensureFile(): Promise<void> {
    if (this.ensured) {
      return;
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await stat(this.filePath);
    } catch {
      await writeFile(this.filePath, "", "utf8");
    }
    this.ensured = true;
  }

  async record(event: CaptureEvent): Promise<void> {
    const entry = {
      recordedAt: new Date().toISOString(),
      ...event
    };
    const line = `${JSON.stringify(entry)}\n`;
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await this.ensureFile();
        await this.rotateIfNeeded(Buffer.byteLength(line));
        await appendFile(this.filePath, line, "utf8");
      });
    return this.writeQueue;
  }

  async summarize(): Promise<CaptureDiagnosticsSummary> {
    const events = await this.readEvents();
    const byKind: Record<string, number> = {};
    const byPlatform: Record<GamePlatform, number> = { tcga: 0, atlas: 0 };
    const latest = new Map<GamePlatform, CapturePlatformEvidence>();

    for (const event of events) {
      byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;
      byPlatform[event.platform] += 1;
      latest.set(event.platform, evidenceFromEvent(event));
    }

    return {
      path: this.filePath,
      totalEvents: events.length,
      lastEventAt: events.at(-1)?.capturedAt ?? "",
      byKind,
      byPlatform,
      latest: ["tcga", "atlas"].map((platform) => latest.get(platform as GamePlatform)).filter(Boolean) as CapturePlatformEvidence[]
    };
  }

  async createBundle(): Promise<string> {
    const events = await this.readEvents();
    const summary = await this.summarize();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const bundlePath = join(dirname(this.filePath), `riftlite-capture-diagnostics-${stamp}.json`);
    await writeFile(bundlePath, `${JSON.stringify({ summary, events }, null, 2)}\n`, "utf8");
    return bundlePath;
  }

  private async readEvents(): Promise<CaptureEvent[]> {
    await this.writeQueue.catch(() => undefined);
    await this.ensureFile();
    const raw = await readFile(this.filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-600)
      .map((line) => {
        try {
          return JSON.parse(line) as CaptureEvent;
        } catch {
          return null;
        }
      })
      .filter((event): event is CaptureEvent => Boolean(event?.platform && event.kind));
  }

  private async rotateIfNeeded(nextBytes: number): Promise<void> {
    this.bytesSinceRotateCheck += nextBytes;
    const now = Date.now();
    if (this.bytesSinceRotateCheck < ROTATE_CHECK_BYTES && now < this.nextRotateCheckAt) {
      return;
    }
    this.bytesSinceRotateCheck = 0;
    this.nextRotateCheckAt = now + ROTATE_CHECK_MS;
    try {
      const info = await stat(this.filePath);
      if (info.size < MAX_LOG_BYTES) {
        return;
      }
      await rename(this.filePath, `${this.filePath}.old`);
      await writeFile(this.filePath, "", "utf8");
      this.ensured = true;
    } catch {
      await writeFile(this.filePath, "", "utf8");
      this.ensured = true;
    }
  }
}

function evidenceFromEvent(event: CaptureEvent): CapturePlatformEvidence {
  const payload = event.payload ?? {};
  const score = payload.score && typeof payload.score === "object" ? payload.score as Record<string, unknown> : {};
  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  return {
    platform: event.platform,
    lastEventAt: event.capturedAt,
    url: event.url,
    active: payload.active === true,
    player: readString(payload.myName),
    opponent: readString(payload.opponentName),
    score: [readString(score.me), readString(score.opp)].filter(Boolean).join("-"),
    format: readString(payload.format),
    hasCards: cards.length > 0,
    cardCount: cards.length,
    logRows: rows.length,
    roomCode: readString(payload.roomCode),
    endText: readString(payload.endText),
    payloadKeys: Object.keys(payload).sort()
  };
}

function readString(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" ? value.trim() : "";
}
