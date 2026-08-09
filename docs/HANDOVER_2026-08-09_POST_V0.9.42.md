# RiftLite Handover — Post v0.9.42

Date: 2026-08-09

## Live release state

- Canonical desktop source: `C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06`
- Release commit: `cdf45b4a9e4bdb760b2d502cbfae96802afda1c8`
- Windows tag/release: `v0.9.42` — `https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.42`
- macOS tag/release: `mac-v0.9.42` — `https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.42`
- Native Mac workflow: `https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/31316552678`
- Both repositories' `main` and `agent/release-v0.9.12` branches contain the release source. The annotated release tags remain fixed on the release commit; later documentation commits must not move them.
- Website production source: `040b71e5bbc32c6095c165557b568e13cc3b09f3` on `cdfpartridge-web/Riftlite` `main`. That exact commit is deployed and includes live takeover, replay fullscreen, and normalized Meta Studio aggregation.

## What shipped

- Home can replace the creator-video carousel with a Meta Studio-controlled Twitch stream after the configured channel is verified live. It autoplays muted, uses an isolated non-persistent partition, and can be hidden for the session.
- Web Replay has desktop-level fullscreen without remounting the guest. The hosted frame-by-frame player has its own labelled fullscreen control and `F` / `Esc` shortcuts.
- Atlas Stacked Deck and related Deck Peek/trash/rewind/setup controls can no longer become opponent identities and trigger phantom incomplete Match Reviews. Same-room low-trust identity changes are pinned; authoritative opponent changes still create a real session boundary.
- **Review later** returns after the pending match is durable. Replay/Web Replay finalization continues in a non-blocking retryable lane, confirmation re-arms it, and deletion retains its finalization fence.

## Validation and artifacts

- Desktop: TypeScript lint passed; 115 test files / 1,052 tests passed; production build, Windows executable/updater/archive verification, and packaged smoke passed.
- Windows installer: 221,597,813 bytes; SHA-256 `CD3BD7375ABDDECFB0D60308B34DD9DDCD5BB76CE68E2D3C4E1F8EA4EE3C3E67`.
- Windows blockmap: 209,420 bytes; SHA-256 `AA1CEA3EA4E44379E3DFB6A7FB77273BEC7945EE3F9B86F96CB421254292D5A9`.
- Windows `latest.yml`: 344 bytes; SHA-256 `ECE94456CEBC2AA017B2D1D3E601F6216998ACFFC0C8EBED9E0B6D3D73D181BB`.
- Apple Silicon DMG: 173,788,026 bytes; SHA-256 `5F3AAB0953E5556AC138C51121DFDE3F0968D8D539033DB71A41AE370CC5F549`.
- Apple Silicon ZIP: 166,355,395 bytes; SHA-256 `80AE22DAAB216ACA91301475F0BBDD74348C008C145048E6623C34864F1F8E4F`.
- Intel DMG: 188,958,044 bytes; SHA-256 `AACC06A4798ABF64C8446292250B4DD4C733C688026EF33D502AA1E70F5254EE`.
- Intel ZIP: 181,255,729 bytes; SHA-256 `67EB0C4E2FA50344923192E9B64135F107EB0D50B569F2710C06EE62912E35E3`.
- `latest-mac.yml`: 830 bytes; SHA-256 `B3E09E15A3CC50E395DD4EABF71F99FAB99969B6338071F10F089BAF088E02A9`.
- The native workflow verified Intel/Apple Silicon app and FFmpeg architectures, updater/bundle identity, strict ad-hoc codesign, both DMGs, and packaged startup. Downloaded assets independently matched GitHub hashes and every updater-manifest size/SHA-512 relationship.

## Known constraints

- macOS remains ad-hoc signed and is not notarized. Manual DMG replacement, Control-click **Open**, or **Open Anyway** may still be required; the first move to Developer ID signing will also require a manual bridge release.
- TCGA Web Replay remains BO1-only.
- `tmp/` in the desktop worktree remains untracked and not ignored. It contains generated browser profiles, cookies, credentials, and databases. Never use `git add -A`; stage explicit paths only.
- Local `release/latest-mac.yml` and local Mac artifacts are stale historical files. Trust the native workflow/release assets, not local Windows-hosted Mac files.

## Starting the next task

Read this file, `docs/CURRENT_STATE.md`, `docs/WEB_REPLAY_SYSTEM_HANDOVER.md`, and the current request. Preserve continuity IDs, profile/media directories, updater repositories, and both release remotes. Do not move the v0.9.42 release tags.
