# Radiance preview catalog — 30 September 2026

Prepared for desktop v0.9.79 and the corresponding web replay release. Publication is recorded separately in the release receipt.

## Sources and coverage

Audited the full paginated [Piltover Archive Radiance library](https://piltoverarchive.com/cards?sets=RAD) (83 entries) against [Riot's card gallery](https://playriftbound.com/en-us/card-gallery/) (84 Radiance entries). RiftCodex currently returns zero Radiance cards.

The union has **88 collector identities**: 40 Units, 13 Gears (including Bomb), 12 Spells, 14 Legend printings covering six champions, five Battlefields and four Rune printings. Piltover adds three signed prints and Bomb beyond Riot's gallery; two Ahri promotional artworks share RAD-038 and are retained as image aliases. All 90 image URLs returned HTTP 200 with image content types.

The full registry contains **1,277 prints and 1,275 Riot hash identities**. All previous 1,189 normalized card records are unchanged. No unrevealed card identities, text or costs are invented.

## Corrections checked against printed art

Riot's metadata currently misclassifies RAD-012, 033, 034, 035, 046, 056, 059, 069, 127 and 136. The bundled types match the printed cards and Piltover. RAD-090A Evelynn is five Energy and one Power, rather than the gallery metadata's three and zero. Heimerdinger's name/tag spelling uses Riot's card; Piltover's misspelling remains an alias.

## Implementation

Preview records are in the validated desktop registry overlay, with provider identifiers and audit provenance. The normal registry updater retains these even while the main feed has no RAD records; per-set statistics now include overlay-only sets. Required-print expectations prevent accidental loss of any current reveal. Update the audited overlay and expectations as new previews appear, then run npm run cards:registry:update.

Capture resolves known preview image URLs as well as collector IDs and Riot hashes; ambiguous URLs fail closed. The desktop legend picker, artwork, domain themes, battlefield catalog and TCGA text matcher include the new setup cards. Captured Ahri promotional art stays distinct.

The web replay renderer includes an audited Radiance image fallback, preserves trusted captured preview art, recognises the new battlefields and renders name-only Bomb tokens. Signed codes accept star, encoded star and -star URL spellings. The legacy replay view, website legend choices/images and compact training registry are updated too. Replay layout and rules execution are unchanged.

## Verification

Targeted tests cover every revealed identity and image fallback, all setup cards, printed metadata corrections, distinct alternate/signed/rune/promo art, encoded signatures, untrusted image fallback, name-only Bomb tokens and ambiguous preview image URLs. Full-suite and installer results belong in the final release receipt.

Local audit snapshots, printed-card contact sheet, source comparison and HTTP evidence: desktop output/radiance-20260930/. These public-source snapshots are not packaged.
