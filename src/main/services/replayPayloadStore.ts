import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import type { DeckTrackerSnapshot, ReplayRecord } from "../../shared/types.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const REPLAY_PAYLOAD_MAX_EXPANDED_BYTES = 256 * 1024 * 1024;

export const REPLAY_PAYLOAD_POINTER_KEY = "__riftliteReplayPayload";

export interface ReplayPayloadReference {
  version: 1;
  fileName: string;
  sha256: string;
  compressedBytes: number;
  expandedBytes: number;
}

export type StoredReplayRecord = ReplayRecord & {
  [REPLAY_PAYLOAD_POINTER_KEY]?: ReplayPayloadReference;
};

type ReplayPayloadFields = Pick<
  ReplayRecord,
  "events" | "structuredEvents" | "visualFrames" | "layers" | "flags" | "annotations" | "voiceNotes"
>;

type JsonDelta =
  | { kind: "replace"; value: unknown }
  | { kind: "object"; changes: Record<string, JsonDelta>; deleted?: string[] }
  | { kind: "array"; changes: Record<string, JsonDelta> };

interface DeltaDeckTrackerSnapshot {
  id: string;
  capturedAt: string;
  reason: string;
  state?: DeckTrackerSnapshot["state"];
  delta?: JsonDelta;
}

interface ReplayPayloadDocument {
  schema: "riftlite-replay-payload";
  version: 1;
  fields: ReplayPayloadFields;
  deckTrackerSnapshots?: {
    encoding: "state-delta-v1";
    items: DeltaDeckTrackerSnapshot[];
  };
}

export interface PreparedReplayPayload {
  replay: ReplayRecord;
  stored: StoredReplayRecord;
  reference: ReplayPayloadReference;
}

export class ReplayPayloadStore {
  constructor(private readonly directory: string) {}

  async prepare(replay: ReplayRecord): Promise<PreparedReplayPayload> {
    const document = replayPayloadDocument(replay);
    const expanded = Buffer.from(JSON.stringify(document), "utf8");
    if (expanded.byteLength > REPLAY_PAYLOAD_MAX_EXPANDED_BYTES) {
      throw new Error("Replay payload is too large to store safely.");
    }
    const compressed = await gzipAsync(expanded, { level: 6 });
    const sha256 = createHash("sha256").update(compressed).digest("hex");
    const replayKey = createHash("sha256").update(replay.id).digest("hex").slice(0, 20);
    const fileName = `${replayKey}-${sha256}.json.gz`;
    await this.writeImmutable(fileName, compressed);
    const reference: ReplayPayloadReference = {
      version: 1,
      fileName,
      sha256,
      compressedBytes: compressed.byteLength,
      expandedBytes: expanded.byteLength
    };
    return {
      replay,
      stored: storedReplayWithReference(replay, reference),
      reference
    };
  }

  async hydrate(stored: StoredReplayRecord): Promise<ReplayRecord> {
    const reference = replayPayloadReference(stored);
    if (!reference) {
      return withoutReplayPayloadReference(stored);
    }
    const path = this.pathFor(reference.fileName);
    const compressed = await readFile(path);
    if (compressed.byteLength !== reference.compressedBytes) {
      throw new Error(`Replay payload size check failed for ${stored.id}.`);
    }
    const sha256 = createHash("sha256").update(compressed).digest("hex");
    if (sha256 !== reference.sha256) {
      throw new Error(`Replay payload checksum failed for ${stored.id}.`);
    }
    const expanded = await gunzipAsync(compressed, { maxOutputLength: REPLAY_PAYLOAD_MAX_EXPANDED_BYTES });
    const parsed = JSON.parse(expanded.toString("utf8")) as ReplayPayloadDocument;
    if (parsed?.schema !== "riftlite-replay-payload" || parsed.version !== 1 || !parsed.fields) {
      throw new Error(`Replay payload format is not supported for ${stored.id}.`);
    }
    const metadata = withoutReplayPayloadReference(stored);
    return {
      ...metadata,
      ...parsed.fields,
      events: Array.isArray(parsed.fields.events) ? parsed.fields.events : [],
      deckTrackerSnapshots: decodeDeckTrackerSnapshots(parsed.deckTrackerSnapshots)
    };
  }

  private async writeImmutable(fileName: string, contents: Buffer): Promise<void> {
    const path = this.pathFor(fileName);
    if (existsSync(path)) {
      return;
    }
    await mkdir(this.directory, { recursive: true });
    const tempPath = join(this.directory, `.${fileName}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await writeFile(tempPath, contents, { flag: "wx" });
      if (existsSync(path)) {
        await unlink(tempPath).catch(() => undefined);
        return;
      }
      await rename(tempPath, path);
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  private pathFor(fileName: string): string {
    if (!/^[a-f0-9]{20}-[a-f0-9]{64}\.json\.gz$/.test(fileName) || basename(fileName) !== fileName) {
      throw new Error("Replay payload path is invalid.");
    }
    return join(this.directory, fileName);
  }
}

export function replayPayloadReference(stored: StoredReplayRecord): ReplayPayloadReference | null {
  const candidate = stored[REPLAY_PAYLOAD_POINTER_KEY];
  if (
    !candidate || candidate.version !== 1 ||
    typeof candidate.fileName !== "string" || typeof candidate.sha256 !== "string" ||
    !Number.isFinite(candidate.compressedBytes) || !Number.isFinite(candidate.expandedBytes)
  ) {
    return null;
  }
  return candidate;
}

export function storedReplayWithReference(
  replay: ReplayRecord,
  reference: ReplayPayloadReference
): StoredReplayRecord {
  const stored: StoredReplayRecord = {
    ...replay,
    events: [],
    [REPLAY_PAYLOAD_POINTER_KEY]: reference
  };
  delete stored.structuredEvents;
  delete stored.visualFrames;
  delete stored.layers;
  delete stored.flags;
  delete stored.annotations;
  delete stored.voiceNotes;
  delete stored.deckTrackerSnapshots;
  return stored;
}

export function withoutReplayPayloadReference(stored: StoredReplayRecord): ReplayRecord {
  const replay = { ...stored };
  delete replay[REPLAY_PAYLOAD_POINTER_KEY];
  return replay;
}

export function replayPayloadFieldsShareIdentity(current: ReplayRecord, candidate: ReplayRecord): boolean {
  return current.events === candidate.events &&
    current.structuredEvents === candidate.structuredEvents &&
    current.visualFrames === candidate.visualFrames &&
    current.layers === candidate.layers &&
    current.flags === candidate.flags &&
    current.annotations === candidate.annotations &&
    current.voiceNotes === candidate.voiceNotes &&
    current.deckTrackerSnapshots === candidate.deckTrackerSnapshots;
}

function replayPayloadDocument(replay: ReplayRecord): ReplayPayloadDocument {
  return {
    schema: "riftlite-replay-payload",
    version: 1,
    fields: {
      events: replay.events ?? [],
      structuredEvents: replay.structuredEvents,
      visualFrames: replay.visualFrames,
      layers: replay.layers,
      flags: replay.flags,
      annotations: replay.annotations,
      voiceNotes: replay.voiceNotes
    },
    deckTrackerSnapshots: encodeDeckTrackerSnapshots(replay.deckTrackerSnapshots)
  };
}

export function encodeDeckTrackerSnapshots(
  snapshots: DeckTrackerSnapshot[] | undefined
): ReplayPayloadDocument["deckTrackerSnapshots"] {
  if (!snapshots?.length) {
    return undefined;
  }
  let previousState: DeckTrackerSnapshot["state"] | undefined;
  const items = snapshots.map((snapshot) => {
    const base = {
      id: snapshot.id,
      capturedAt: snapshot.capturedAt,
      reason: snapshot.reason
    };
    if (!previousState) {
      previousState = snapshot.state;
      return { ...base, state: snapshot.state };
    }
    const delta = jsonDelta(previousState, snapshot.state);
    previousState = snapshot.state;
    return delta ? { ...base, delta } : base;
  });
  return { encoding: "state-delta-v1", items };
}

export function decodeDeckTrackerSnapshots(
  encoded: ReplayPayloadDocument["deckTrackerSnapshots"]
): DeckTrackerSnapshot[] | undefined {
  if (!encoded?.items?.length || encoded.encoding !== "state-delta-v1") {
    return undefined;
  }
  let state: DeckTrackerSnapshot["state"] | undefined;
  const snapshots: DeckTrackerSnapshot[] = [];
  for (const item of encoded.items) {
    if (item.state) {
      state = item.state;
    } else if (state && item.delta) {
      state = applyJsonDelta(state, item.delta) as DeckTrackerSnapshot["state"];
    }
    if (!state) {
      throw new Error("Replay deck-tracker delta is missing its base state.");
    }
    snapshots.push({ id: item.id, capturedAt: item.capturedAt, reason: item.reason, state });
  }
  return snapshots;
}

function jsonDelta(previous: unknown, next: unknown): JsonDelta | undefined {
  if (Object.is(previous, next)) {
    return undefined;
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length !== next.length) {
      return { kind: "replace", value: next };
    }
    const changes: Record<string, JsonDelta> = {};
    for (let index = 0; index < next.length; index += 1) {
      const change = jsonDelta(previous[index], next[index]);
      if (change) changes[String(index)] = change;
    }
    return Object.keys(changes).length ? { kind: "array", changes } : undefined;
  }
  if (isJsonObject(previous) && isJsonObject(next)) {
    const changes: Record<string, JsonDelta> = {};
    const deleted = Object.keys(previous).filter((key) => !Object.prototype.hasOwnProperty.call(next, key));
    for (const key of Object.keys(next)) {
      const change = jsonDelta(previous[key], next[key]);
      if (change) changes[key] = change;
    }
    return Object.keys(changes).length || deleted.length
      ? { kind: "object", changes, ...(deleted.length ? { deleted } : {}) }
      : undefined;
  }
  return { kind: "replace", value: next };
}

function applyJsonDelta(previous: unknown, delta: JsonDelta): unknown {
  if (delta.kind === "replace") {
    return delta.value;
  }
  if (delta.kind === "array") {
    if (!Array.isArray(previous)) throw new Error("Replay array delta has no array base.");
    const next = [...previous];
    for (const [key, change] of Object.entries(delta.changes)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= next.length) {
        throw new Error("Replay array delta index is invalid.");
      }
      next[index] = applyJsonDelta(next[index], change);
    }
    return next;
  }
  if (!isJsonObject(previous)) throw new Error("Replay object delta has no object base.");
  const next: Record<string, unknown> = { ...previous };
  for (const key of delta.deleted ?? []) delete next[key];
  for (const [key, change] of Object.entries(delta.changes)) {
    next[key] = applyJsonDelta(next[key], change);
  }
  return next;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
