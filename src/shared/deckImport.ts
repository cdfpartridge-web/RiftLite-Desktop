import { normalizeLegendName } from "./legendNames.js";

/** Content matching is for offering import choices, never for merging stats identities. */
export function deckContentFingerprint(snapshot: Record<string, unknown>): string {
  const block = (label: string, rawEntries: unknown): string => {
    const entries = Array.isArray(rawEntries) ? rawEntries : rawEntries && typeof rawEntries === "object" ? [rawEntries] : [];
    const values = entries.map((entry) => {
      const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      const name = label === "legend" ? normalizeLegendName(record.name) : String(record.name ?? "").trim();
      const qty = Number(record.qty ?? 1) || 1;
      return name ? `${qty}x${name.toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
    }).filter(Boolean).sort();
    return `${label}:${values.join("|")}`;
  };
  return [
    block("legend", snapshot.legend_entry || { name: snapshot.legend, qty: 1 }),
    block("runes", snapshot.runes), block("battlefields", snapshot.battlefields),
    block("main", snapshot.main_deck || snapshot.mainDeck), block("side", snapshot.sideboard)
  ].join("||");
}

export function deckImportSnapshot(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}
