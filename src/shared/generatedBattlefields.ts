import { riftboundCardCodeFromValue } from "./cardIdentity.js";

// TCGA's Chinese names and artwork for UNL-T01 and UNL-T03.
const TCGA_GENERATED_BATTLEFIELD_NAMES = new Set(["男爵巢穴", "草丛"]);
const TCGA_GENERATED_BATTLEFIELD_IMAGE_FILES = new Set(["4c3cd4ae3cb7.jpeg", "1d5125e5af29.jpeg"]);

/** Generated battlefield tokens must not replace the battlefield chosen for a game. */
export function isGeneratedBattlefieldName(value: unknown): boolean {
  const name = readString(value);
  return TCGA_GENERATED_BATTLEFIELD_NAMES.has(name) || /\b(?:baron\s+pit|brush)\b/i.test(name);
}

export function isGeneratedBattlefieldCode(value: unknown): boolean {
  const code = riftboundCardCodeFromValue(readString(value));
  return code === "UNL-T01" || code === "UNL-T03";
}

export function isGeneratedBattlefieldImage(value: unknown): boolean {
  const image = readString(value);
  if (isGeneratedBattlefieldCode(image)) {
    return true;
  }
  const filename = image.split(/[?#]/, 1)[0].split("/").at(-1)?.toLowerCase() ?? "";
  return TCGA_GENERATED_BATTLEFIELD_IMAGE_FILES.has(filename) ||
    /baron[-_\s]?pit|brush|e44f173629322a4e0c32d3f8902c294d4482ef42|fad09d6bd9bf38e376f430ecb0b400762420d061/i.test(image);
}

export function isGeneratedBattlefieldCandidate(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  // UI text such as "Tap" can coexist with a useful name, code or image.
  return isGeneratedBattlefieldName(candidate.text) ||
    isGeneratedBattlefieldName(candidate.name) ||
    isGeneratedBattlefieldName(candidate.code) ||
    isGeneratedBattlefieldCode(candidate.code) ||
    isGeneratedBattlefieldImage(candidate.image);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
