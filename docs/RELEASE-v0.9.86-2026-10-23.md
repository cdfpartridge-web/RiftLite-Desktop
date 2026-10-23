# RiftLite v0.9.86 — published 23 October 2026

Windows, Mac Apple Silicon and Mac Intel are public and Latest. The matching official Radiance season website update is live. The user explicitly authorized a version bump and publication; the season cutoff was fixed when they answered “From now”.

## Published scope

- Official Radiance is the default across personal and community history, stats, deck analysis, Insights, profiles, teams, hubs and replay filters. A fresh reminder explains the change.
- Fixed inclusive start: **2026-10-23T12:11:27.000Z**, or **23 October 2026 at 13:11:27 Europe/London (BST)**. Do not move this to a later build time. Radiance pre-season retains its original start and ends exclusively at this boundary. Older seasons and All seasons remain selectable.
- Interactive replays lead Quick setup, Review and Recording & sharing. Fresh devices capture interactive data with video/timed screenshots off. Existing preferences and legacy behavior are preserved. Uploads, sharing, microphone and cloud backup remain explicit choices.
- Duplicate text/Piltover imports offer Update existing or Save as separate deck with its own name and stats.
- Live video writes use local app storage; completed media is safely published to the selected folder. This mitigates growing writes in synced folders. The underlying Atlas pause investigation is still open; a real-game video-off comparison remains pending.

Match history is preserved without migration. Recorded time takes precedence over upload time; date-only records retain midnight UTC. Historical training cohorts keep their existing scope. Opening Turns Lab and Replay Coach remain Coming soon.

## Immutable publication

- Desktop runtime: `6b837cc24cf0b9aec301d080f06adf450bba9f47`. Both windows/main and origin/main were fast-forwarded; v0.9.86 and mac-v0.9.86 tags remain pinned to this runtime.
- [Windows v0.9.86](https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.86), release 421811915.
- [Mac v0.9.86](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.86), release 421812180.
- [Native Mac build 39952503589](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/39952503589).
- Website runtime: `520c4c49776bee683380d72698337054c59b9362`; deployment `dpl_8Qk5bD4m31uZHJXW21gw14e33a3F`, live at https://www.riftlite.com.
- Website rollback remains `dpl_6PQbwc9WzjZFDVGCPurEg1bnc4F1`. No previous deployment, release, tag or artifact was replaced.

## Validation and artifacts

Clean Windows and native Mac each passed TypeScript, **2,930 tests (258 files)**, **82 account checks**, production compilation, platform packaging and isolated packaged startup. Windows first-install UI checks passed. Native Mac architecture/FFmpeg, strict signature, DMG and packaged startup gates all passed. Mac remains ad hoc signed, not notarized.

All eight public assets were downloaded and verified against size/SHA256; update manifests also passed size/SHA512 checks. Both Latest endpoints, immutable tags and all three website platform download links resolve correctly. Both downloaded Mac applications match all **357 compiled files and 60 resources** of the verified Windows build. Downloaded Mac applications were inspected, not executed on Windows.

Website source passed **1,772 tests (nine skipped)**, scoped lint and source TypeScript, followed by the exact-archive production build. Candidate and live checks each passed 54 read-only HTTP GETs, including private review authentication protections. Live isolated browser checks covered defaults/reminder, pre-season/All navigation, empty cohorts, replay archives and fresh mobile views. No app console errors. Existing third-party AdSense warning remains; a desktop ad retained width immediately after resizing, while fresh mobile navigation passed without overflow.

Fresh Windows installer: sibling `release-v0.9.86/release/RiftLiteBetaInstall.exe`, **159,759,341 bytes**, SHA256 `2e70acc12b1a2d78eed35532b90d9b4bf7f511fb8640655db98951d8bab34e34`. This exactly matches the public Windows installer. Older canonical/local candidates remain untouched.

Evidence: desktop `output/release-v0.9.86-final/` (publication, platform/public verification, native Mac gates/parity and preservation receipts); website `output/release-radiance-20261023/` (runtime archive, deployment, HTTP, live browser and publication receipts).

Before receipt edits, 90 older artifact files and 723 unrelated desktop files were verified unchanged. Website next-env.d.ts remains SHA256 `3b942af44c5547b81cbd961c8f99001767ea89e2b6ec6923afbfd199369af814`; local demo files and existing dirty/untracked work are preserved. No app installation, real-profile launch, Discord announcement or production account/match-data mutation was performed.
