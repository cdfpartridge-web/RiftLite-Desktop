# Desktop known opponent hand — 3 October 2026

Local fix for the Atlas in-game overlay. The website reveal repair is separate and was already deployed from the website checkout. This desktop change has not been published or installed and retains version 0.9.80.

## Cause and correction

The desktop tracker required a `set_board_fields.handRevealToOpponent` directive with a hand replacement. Current Atlas uses individual card `revealedToOpponent: true` flags instead. A recent Viktor capture contained five explicit revealed identities at frame 516, but the released tracker retained zero cards.

The tracker now accepts explicit per-card evidence from incoming authoritative hand inserts, field patches and reconnect snapshots. It keeps this separate from legacy whole-hand permission, so a reveal never authorizes unrelated hidden draws. Known cards remain a memory aid after concealment; exact plays, chain entries and departures remove them, and returns to hidden decks expire identity tracking. Reconnects revoke stale whole-hand permission and reconcile complete exact hands. Unknown viewpoints, spectators, conflicting ownership and ambiguous opponents fail closed.

The overlay describes its list as known cards, including remembered possibilities, instead of claiming every remembered card is currently revealed.

Changed runtime files:

- `src/shared/atlasKnownOpponentHand.ts`
- `src/renderer/App.tsx`

Regression coverage: `tests/atlasKnownOpponentHand.test.ts`.

## Validation

- Final `npm run release:gate`: TypeScript passed, 82 account-sync checks passed, 236 files / 2,563 tests passed.
- Tracker coverage increased from 17 to 31 tests, including modern five-card reveals, partial reveals, hidden draws, reconnects, concealment, departures, ownership and lifecycle boundaries.
- Independent code review and integration checks passed.
- Read-only replay of 16 recent local captures / 9,619 messages found four modern reveal events: one in the Viktor game and three in the Ziggs game. They yielded 5, 5, 4 and 4 known cards respectively. No displayed identity lacked explicit earlier reveal evidence; the other 14 captures introduced no known cards. Played cards were removed and hidden draws stayed unknown.
- Diagnostic scripts and sanitized summaries: `output/known-hand-20261003/`. Raw captures remain in the user's original capture directory and are not added to source control.

## Local installer

Completed at 21:42 BST. Candidate directory: `output/local-known-hand-20261003-2135/`.

- Installer: `RiftLiteBetaInstall.exe`, 159,488,319 bytes.
- SHA-256: `ee6aa9111f4c723ead119e15bb77ab0c3ffda306262dcc8f3ef0665653a9108b`.
- Clean production build and NSIS packaging passed, with `--publish never` and a separate output directory.
- Windows artifact, executable metadata and updater/hash checks passed.
- All 328 compiled files match the package; source fingerprints match those recorded after the final test gate. `App.tsx` retains LF endings.
- Packaged startup smoke passed using a temporary isolated profile.

Public Windows/macOS artifacts remain the immutable v0.9.80 release. The running installed app was not stopped, installed over or modified, and its profile was read only. Live gameplay acceptance is still required after manually installing the local candidate. Source changes remain local and uncommitted.
