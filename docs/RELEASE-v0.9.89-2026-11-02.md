# RiftLite v0.9.89 — published 2 November 2026

Windows, Mac Apple Silicon and Mac Intel are public and Latest. The user explicitly authorized the version bump and live desktop release.

## Changes

- Atlas All cards now accepts strictly validated native setup prefixes and discovers coherent deciding games and two-game sweeps with stale cumulative scores. For a two-game candidate, the final native winner must match the captured first-game leader; the final game must attach successfully before the first game can proceed. Ownership, original replay access and private-deck restrictions remain enforced.
- Eligible recent captures retry transient collection failures with bounded backoff. Gameplay/navigation cancellation defers collection, and original replay publication triggers run through the idle maintenance scheduler.
- Replay/history/account work is serialized behind gameplay activity checks; renderer performance handling and bounded diagnostics are improved. Existing cloud data, retryable work and account boundaries are preserved.
- Home has one saved-provider Play action, followed by Community Spotlight, creator videos and partners. BMUCasts and EMOEtional are included. The expired Radiance notice and Home season/date toolbar are removed; season controls elsewhere remain.

Original replay captures, Player view, sharing controls and private notes remain intact. Regression and native-export pipeline checks passed; successful live Atlas retrieval and rendered All cards after this release still need user confirmation. The transport-stall cause remains unproven. Fully restart after updating and open signed-in Play -> Atlas; return to the lobby after a BO3. Automatic collection remains limited to eligible Ready captures within six hours, with no promise of older-game recovery.

## Immutable release

- Runtime: `9f1054bc1eac056c3db2e0cfd5077738adc40100`; new tags `v0.9.89` and `mac-v0.9.89` stay pinned here. Both desktop main branches contain this source; later receipt commits change documentation only.
- [Windows release](https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.89) and [Mac release](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.89).
- [Native Mac build 41463587434](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/41463587434). Both releases remained drafts until platform and cross-platform checks passed.
- Website unchanged at runtime `4c31b847a409543ef16a01f94f39984b557c193d`, deployment `dpl_FjNRec2TDFzD4Sgx6psiCNX2jxvG`; no website redeploy.

## Verification

Fresh immutable Windows and native Mac builds each passed TypeScript, **3,374 tests in 268 files** and **94 account checks**, compilation and packaging. Windows passed artifact/updater/blockmap verification and isolated hidden packaged startup/first-install checks. Mac passed both architectures, FFmpeg, signatures and DMG checks; startup ran on the Apple Silicon CI runner. Intel received package/signature/content verification rather than a native Intel startup run. Mac remains ad hoc signed without notarization.

Both Mac archives match all **369 compiled files and 64 resources** in the verified Windows package. The package audit includes the latest All cards, Home and creator changes. All eight public asset downloads passed size/SHA256 checks and both update feeds passed size/SHA512 checks. Both Latest endpoints and all three website platform download links resolve to v0.9.89. Previous v0.9.88 release metadata, tags and assets remain unchanged.

Windows installer: `../release-v0.9.89/release/RiftLiteBetaInstall.exe`, **164,363,832 bytes**, SHA256 `69a2374fff953211fb1102d3d772fd65e60cebd4d0ff6e489530a8dbcba3ff72`. It exactly matches the public download. Evidence: `output/release-v0.9.89-20261102/`.

Preservation checks verified **141 prior installer artifacts**, **365 old compiled files**, **801 unrelated desktop files**, all **828 website files** and **14 additional configuration/build-info/preview files**, including website Git state. Pre-existing dirty/untracked historical notes remain local. No agent installation, real-profile launch, Discord announcement, production replay rewrite or account-data mutation occurred.
