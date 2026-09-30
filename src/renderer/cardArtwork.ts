import cardRegistryData from "../../resources/riftbound_card_registry.json";
import {
  riftboundCardCodeAliases,
  riftboundCardCodeFromValue,
  riftboundCanonicalArtCode
} from "../shared/cardIdentity";
import { deckTrackerImageUrlFromId } from "../shared/deckTracker";

const CARD_IMAGE_BY_CODE: ReadonlyMap<string, string> = new Map(
  cardRegistryData.cards.flatMap((card) => {
    const code = riftboundCardCodeFromValue(card.printId);
    const imageUrl = card.imageUrl.trim();
    return code && imageUrl ? [[code, imageUrl] as const] : [];
  })
);
const CAPTURED_ART_ALIASES = new Map(cardRegistryData.cards.flatMap(card =>
  "imageUrlAliases" in card && Array.isArray(card.imageUrlAliases)
    ? card.imageUrlAliases.map(url => [url, card.printId] as const) : []
));

/** Fallback aliases are queried in order, never registered over exact prints. */
export function resolveBundledCardImage(
  value: string,
  imageByCode: ReadonlyMap<string, string> = CARD_IMAGE_BY_CODE
): string {
  const code = riftboundCardCodeFromValue(value);
  const exact = exactPrintImage(code, imageByCode);
  if (exact) return exact;
  for (const alias of riftboundCardCodeAliases(value)) {
    const image = imageByCode.get(alias);
    if (image) return image;
  }
  const canonicalArtCode = riftboundCanonicalArtCode(value);
  return canonicalArtCode ? imageByCode.get(canonicalArtCode) || "" : "";
}

/** A captured/imported image must not lose to a different bundled printing. */
export function resolveCardArtwork(
  value: string,
  sourceImageUrl = "",
  imageByCode: ReadonlyMap<string, string> = CARD_IMAGE_BY_CODE
): string {
  const code = riftboundCardCodeFromValue(value) || riftboundCardCodeFromValue(sourceImageUrl);
  const aliasCode = CAPTURED_ART_ALIASES.get(sourceImageUrl);
  if (aliasCode && (!code || aliasCode === code)) return sourceImageUrl;
  return exactPrintImage(code, imageByCode) || sourceImageUrl || resolveBundledCardImage(code, imageByCode);
}

function exactPrintImage(code: string, imageByCode: ReadonlyMap<string, string>): string {
  // Atlas spells signed prints with S. Only use that compatibility spelling
  // when the signed print exists, and never override a literal exact S print.
  return imageByCode.get(code)
    || (code.endsWith("S") ? imageByCode.get(code.slice(0, -1) + "*") : "")
    || "";
}

/** Presentation only: card keys, grouping, quantities and saved data stay intact. */
export function resolveDeckCardArtwork(card: {
  cardId?: string;
  code?: string;
  imageUrl?: string;
}): string {
  const code = riftboundCardCodeFromValue(card.cardId || "") || riftboundCardCodeFromValue(card.code || "");
  // Imports can deliberately pair a base ID with selected alternate artwork.
  // Repair only our recognisable generated base URL for a different print.
  const sourceImageUrl = card.imageUrl || "";
  const generatedBaseImage = code !== riftboundCanonicalArtCode(code)
    && sourceImageUrl === deckTrackerImageUrlFromId(code);
  if (sourceImageUrl && !generatedBaseImage) return sourceImageUrl;
  return resolveCardArtwork(code, card.imageUrl)
    || deckTrackerImageUrlFromId(code);
}
