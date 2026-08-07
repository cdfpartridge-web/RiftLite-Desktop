# RiftLite Post-v0.9.37 Handover - 2026-08-07

This is the authoritative handover for the v0.9.37 desktop release. Read it before older handovers, then use `docs/CURRENT_STATE.md` for longer architecture and release history.

## Release State

- Package/display version: `0.9.37`.
- Release source commit: `e672f2e70fd16535f0252ac08a447b92c1fecb06` (`Release RiftLite v0.9.37`).
- Windows tag: `v0.9.37`.
- macOS tag: `mac-v0.9.37`.
- Windows release: `https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.37`.
- macOS release: `https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.37`.
- Native macOS workflow: `https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/31190117490` (success).
- Both repositories use the same release source. Their `main` and `agent/release-v0.9.12` branches should also contain the later publication-documentation commit; the release tags remain fixed on `e672f2e`.
- Both releases are public, non-draft, non-prerelease, and the current latest release in their repository.
- No website deployment, Discord action, or production-data mutation was part of v0.9.37.

## Tester Bug And Root Cause

The tester set BO3 in RiftAtlas, but Match Review appeared after Game 1. Closing, deleting, or deferring it allowed later games to be grouped incorrectly, and additional incomplete review prompts could appear during a game. Once the first forced review write failed, **Save match**, **Review later**, **Delete capture**, and the close button all reported `bad parameter or other API misuse`.

The supplied diagnostic logs showed that Atlas room codes were being selected as `opponentName`. A room-code change between games therefore looked like an opponent change. The session tracker executed `rollover-before-new-session`, force-published Game 1 as Bo1, and broke the intended BO3 continuation. The forced draft write then exposed a sql.js runtime failure that was not in the existing reopen-and-retry classifier, so every later database mutation reused the poisoned runtime.

## Implemented Fix

- `src/game-preload/gamePreload.ts` obtains the Atlas room code before identity extraction and excludes it from DOM, chat, and turn-identity candidates.
- `src/shared/atlasPlayerIdentity.ts` supports normalized excluded identities when choosing the opponent.
- `src/main/services/captureCoordinator.ts` treats an opponent equal to the current room code as noise when deciding whether a pending Atlas BO3 continues.
- `src/main/services/matchSessionTracker.ts` defensively rejects room-code player identities during fresh-session, BO3-continuation, and sticky-field merging.
- `src/main/services/store.ts` classifies `bad parameter or other API misuse` as a sql.js runtime failure, reopens the canonical durable database, and retries the mutation once.
- `src/renderer/App.tsx` gives database-specific recovery guidance if that bounded retry still fails.
- Existing incorrectly split historical match rows are deliberately not auto-merged.

## Regression Coverage And Validation

- New regression cases cover room-code identity exclusion, BO3 continuation across a changed room code, capture-coordinator suppression of the exact false-rollover sequence, and database reopen-and-retry for the reported sql.js error.
- Focused validation passed four files / 144 tests.
- The final Windows release pipeline passed TypeScript lint, the 79-test account-sync gate, all 111 test files / 1,009 tests, the production build, installer/updater verification, executable and NSIS integrity checks, and the isolated packaged smoke test.
- The native macOS workflow passed the same source gates plus Intel and Apple Silicon packaging, architecture-specific FFmpeg checks, updater/bundle identity validation, strict ad-hoc signature verification, DMG verification, and the packaged smoke test.

## Published Artifact Verification

Windows:

- `RiftLiteBetaInstall.exe`: 216,415,717 bytes; SHA-256 `C7EF7C8E3674FB0087CB88DFB2A2C4B0035FA5860B9DC674643B9A2C744487E9`.
- `RiftLiteBetaInstall.exe.blockmap`: 203,419 bytes; SHA-256 `D463D0D8FF270A6E2050C0CC994B3C81EA2B94DEDB8B828A72D75687B0A0FFE6`.
- `latest.yml`: 344 bytes; SHA-256 `BE4C65C053B4D006E3D70425441E4447EB509D33306007CA407E43DC6E357E3F`.

macOS:

- `RiftLiteBetaInstall-arm64.dmg`: 172,797,950 bytes; SHA-256 `AB2A74F148FB747C37CFC074D8E91D050F4D0D89C65C6B19755D0B8813EB1E97`.
- `RiftLiteBetaInstall-arm64.zip`: 165,422,204 bytes; SHA-256 `996A5317BC50AAC193470CA8D1D991D25AFC5616402CA888B7601870644ADEC6`.
- `RiftLiteBetaInstall-x64.dmg`: 187,989,640 bytes; SHA-256 `06BF9CA0CCD8CC2E5AD02E861748FD2D8C5DCE7962200CD27E1F2CEFD6F8B639`.
- `RiftLiteBetaInstall-x64.zip`: 180,322,528 bytes; SHA-256 `172C575C347A72857793B354F5949AE6A27F4D04E97EBBB09A8F68AB827063D2`.
- `latest-mac.yml`: 830 bytes; SHA-256 `C593425AB79D4F598E3CB62B9E9EC8D9192F38586F046AF3B83A47D95A2FE133`.

All eight public assets were downloaded into new temporary directories after publication and matched their GitHub sizes and SHA-256 digests. `latest.yml` and `latest-mac.yml` report version `0.9.37`; each referenced installer size and SHA-512 relationship matches the independently downloaded file.

## Continuity Constraints

Do not change these identifiers during ordinary updates:

- App ID: `com.riftlite.desktop.beta06`.
- Product/executable name: `RiftLite Beta 0.9`.
- User-data directory: `RiftLite Beta 0.6`.
- Media directory: `RiftLite`.
- Protocol: `riftlite`.
- Windows updater repository: `cdfpartridge-web/RiftLite-Desktop`.
- macOS updater repository: `cdfpartridge-web/RiftLite-Desktop-Mac`.

Always name the remote explicitly when pushing: `windows` is the Windows repository and `origin` is the macOS repository. Preserve user changes, and do not move the v0.9.37 release tags when adding later documentation.
