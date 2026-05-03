import { readFile } from "node:fs/promises";
import { normalizeLegendName } from "../../shared/legendNames.js";

interface LookupPayload {
  hashMap?: Record<string, string>;
  codeMap?: Record<string, string>;
}

const CARD_CODE_RE = /\b((?:OGN|OGS|SFD|UNL)-\d+)\b/i;
const HASH_RE = /\b([a-f0-9]{40})\b/i;

export class TcgaResolver {
  private loaded = false;
  private hashMap: Record<string, string> = {};
  private codeMap: Record<string, string> = {};

  constructor(private readonly lookupPath: string) {}

  async resolve(value: unknown): Promise<string> {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return "";
    }
    await this.ensureLoaded();
    const decoded = decodeLoose(raw);
    const hash = decoded.match(HASH_RE)?.[1]?.toLowerCase() ?? "";
    if (hash && this.hashMap[hash]) {
      return this.hashMap[hash];
    }
    const code = decoded.match(CARD_CODE_RE)?.[1]?.toUpperCase() ?? "";
    if (code && this.codeMap[code]) {
      return this.codeMap[code];
    }
    return "";
  }

  async resolveLegend(value: unknown): Promise<string> {
    return normalizeLegendName(await this.resolve(value));
  }

  async resolveBattlefield(value: unknown): Promise<string> {
    return await this.resolve(value);
  }

  async resolveCard(value: unknown): Promise<string> {
    return await this.resolve(value);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const raw = await readFile(this.lookupPath, "utf8");
      const parsed = JSON.parse(raw) as LookupPayload;
      this.hashMap = normalizeKeys(parsed.hashMap ?? {}, "lower");
      this.codeMap = normalizeKeys(parsed.codeMap ?? {}, "upper");
    } catch {
      this.hashMap = {};
      this.codeMap = {};
    }
    this.loaded = true;
  }
}

function normalizeKeys(source: Record<string, string>, mode: "lower" | "upper"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const nextKey = mode === "lower" ? key.toLowerCase() : key.toUpperCase();
    out[nextKey] = value;
  }
  return out;
}

function decodeLoose(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
