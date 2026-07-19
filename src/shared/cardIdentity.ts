/**
 * Collector-code grammar used by Riot/RiftCodex image URLs.
 *
 * A print can be a numbered card, rune, token or special/promo card. Alternate
 * art suffixes are letters and signed cards are represented either by `*` in
 * a public code or `-star` in an image slug. The optional `/set-size` portion
 * of a public code is deliberately not part of the stable identity.
 */
const RIFTBOUND_CARD_CODE_PATTERN =
  /(?:^|[^A-Z0-9])([A-Z]{2,5}-(?:(?:SP|R|T)\d{1,4}|\d{1,4})[A-Z]?(?:\*|-STAR)?)(?=$|[^A-Z0-9*])/i;
const RIFTBOUND_PRINT_CODE_PATTERN =
  /^([A-Z]{2,5}-(?:(?:SP|R|T)\d{1,4}|\d{1,4}))([A-Z]?)(\*)?$/;
const CANONICAL_RUNE_ART_CODES: Record<string, string> = {
  "01": "OGN-007",
  "02": "OGN-042",
  "03": "OGN-089",
  "04": "OGN-126",
  "05": "OGN-166",
  "06": "OGN-214"
};

export function riftboundCardCodeFromValue(value: string): string {
  const decoded = decodeLoose(String(value ?? ""));
  const code = decoded.match(RIFTBOUND_CARD_CODE_PATTERN)?.[1]?.toUpperCase() ?? "";
  return code.replace(/-STAR$/i, "*");
}

export function riftboundBasePrintCode(value: string): string {
  const code = riftboundCardCodeFromValue(value);
  return code.match(RIFTBOUND_PRINT_CODE_PATTERN)?.[1] ?? code;
}

export function riftboundCardCodeAliases(value: string): string[] {
  const code = riftboundCardCodeFromValue(value);
  if (!code) {
    return [];
  }
  const unsignedCode = code.replace(/\*$/, "");
  return [...new Set([code, unsignedCode, riftboundBasePrintCode(code)].filter(Boolean))];
}

export function riftboundCanonicalArtCode(value: string): string {
  const code = riftboundCardCodeFromValue(value);
  const runeNumber = code.match(/^[A-Z]{2,5}-R(\d{1,3})[A-Z]?\*?$/)?.[1]?.padStart(2, "0") ?? "";
  return CANONICAL_RUNE_ART_CODES[runeNumber] ?? riftboundBasePrintCode(code);
}

function decodeLoose(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
