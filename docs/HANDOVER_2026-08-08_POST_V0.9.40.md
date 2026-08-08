# RiftLite Post-v0.9.40 Handover - 2026-08-08

This is the authoritative handover for the v0.9.40 desktop release. Read it before older handovers, then use `docs/CURRENT_STATE.md` for longer architecture and release history.

## Release State

- Package/display version: `0.9.40`.
- Release source commit: `8b75731f7e447b2b065c7d17e99a015c36066f3c` (`Release RiftLite v0.9.40`).
- Windows tag: `v0.9.40`.
- macOS tag: `mac-v0.9.40`.
- Windows release: `https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.40`.
- macOS release: `https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.40`.
- Native macOS workflow: `https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/31253028878` (success).
- Both tags dereference to the same release source commit. Both repositories' `main` and `agent/release-v0.9.12` branches also contain the later publication-documentation commit; the release tags remain fixed on `8b75731`.
- Both releases are public, non-draft, non-prerelease, and the current latest release in their repository.
- No website code, Discord message, replay mutation, or production-data mutation was part of this desktop publication. Frodan's two-slot creator-video feed configuration was already live before the tags were created.

## Home And Play Now

- Home now foregrounds the most recently played saved deck, falling back to the active or latest imported deck when needed.
- The deck surface uses only packaged-registry or curated official card art, and shows the same completed-match cohort for record, win rate, and recent form.
- My Decks, Community Decks, and View My Replays are direct Home actions.
- Play Now persists Atlas or TCGA as the default provider. Provider changes retain the active-capture guard, and unresolved Match Review is opened before a new game can start.
- Default-provider writes are serialized, recover from rapid choices, and reload the durable setting after a failed save.

## Featured Creator

- Frodan is the second Featured Creator after Riftlab.
- The desktop profile uses official social imagery and links to `https://www.youtube.com/@FrodanRB`, `https://www.twitch.tv/frodan`, and `https://x.com/Frodan`.
- The separately deployed creator-video feed weights two Frodan YouTube positions; this desktop release consumes that live feed but did not redeploy the website.

## TCGA Web Replay Repair

- The reported `TCGA awaiting-result artifact exceeds the raw JSON limit` failure was not caused by the tester or the 49 retained Match Review evidence events. Repeated full `playerData` snapshots could expand a valid TCGA RTC stream beyond the existing 32 MiB raw-artifact ceiling.
- Persistence now delta-encodes JSON-identical shallow player-state fields across ordered provider messages. Decoder/replay-ready validation and capture identity still use the untouched source frames, and the current shallow-merge normalizer reconstructs equivalent canonical output.
- The 32 MiB expanded and 4 MiB gzip limits remain unchanged across desktop, browser, and server boundaries.
- A compacted artifact that still exceeds a limit returns a terminal optional-replay skip with bounded stage, encoding, actual-byte, and limit-byte diagnostics. Match persistence and Match Review completion continue instead of retrying an impossible replay artifact.
- Existing local matches and already-published Web Replays are unaffected. An oversized artifact that must be skipped is not available as a Web Replay, but its saved match result remains intact.

## Validation

- Focused validation passed 8 files / 80 tests.
- The final Windows release pipeline passed TypeScript lint, the 79-test account-sync gate, all 112 test files / 1,019 tests, the production build, installer/updater verification, executable and NSIS archive integrity checks, and the isolated packaged smoke test.
- The native macOS workflow passed the same source gates plus Intel and Apple Silicon packaging, architecture-specific FFmpeg checks, updater/bundle identity validation, strict ad-hoc signature verification, DMG verification, and the packaged smoke test.

## Published Artifact Verification

Windows:

- `RiftLiteBetaInstall.exe`: 219,381,270 bytes; SHA-256 `FDBE53238B619C2B0053AA1977AB9A5164C754F438A55C500E4B7DB62548D420`.
- `RiftLiteBetaInstall.exe.blockmap`: 207,215 bytes; SHA-256 `83C8E77451CDC9BECB945E4C924C801E8E9FAA022B13BA5630EEF5F67EDF4FA4`.
- `latest.yml`: 344 bytes; SHA-256 `1FF38A631DF7CCD1627828061CED8A24482021BE63A899DDAE68A5BC0BED79D3`.

macOS:

- `RiftLiteBetaInstall-arm64.dmg`: 173,764,618 bytes; SHA-256 `7B70FAEA8B286B5A58720FCE352FD6126519FA292B58E8534A73C9F11EBBFC1A`.
- `RiftLiteBetaInstall-arm64.zip`: 166,346,588 bytes; SHA-256 `C46FC02056A7BD17460A247E5C6014625C164748974515971A0B85AD0CF47B1E`.
- `RiftLiteBetaInstall-x64.dmg`: 188,890,408 bytes; SHA-256 `78AD8E1CF72E4FB36AA4F701129282EB345E6EBD1E30409EAA82939A947F5E3D`.
- `RiftLiteBetaInstall-x64.zip`: 181,246,915 bytes; SHA-256 `9F5A83476AD6018683E64EC9BB2E591A2E31CB7E92D328909EF59A7C95B48AD3`.
- `latest-mac.yml`: 830 bytes; SHA-256 `2CC5AB1E6686C3370EF3F9EF665BA1B2DEC0D9A000613E4C5C5DA25FFF409DB6`.

All eight assets were downloaded into new temporary directories after publication and matched their GitHub sizes and SHA-256 digests. `latest.yml` and `latest-mac.yml` report version `0.9.40`; each referenced installer size and SHA-512 relationship matches the independently downloaded file.

## Continuity Constraints

Do not change these identifiers during ordinary updates:

- App ID: `com.riftlite.desktop.beta06`.
- Product/executable name: `RiftLite Beta 0.9`.
- User-data directory: `RiftLite Beta 0.6`.
- Media directory: `RiftLite`.
- Protocol: `riftlite`.
- Windows updater repository: `cdfpartridge-web/RiftLite-Desktop`.
- macOS updater repository: `cdfpartridge-web/RiftLite-Desktop-Mac`.

Always name the remote explicitly when pushing: `windows` is the Windows repository and `origin` is the macOS repository. Preserve user changes, do not stage `tmp/`, and never move the v0.9.40 release tags when adding later documentation.
