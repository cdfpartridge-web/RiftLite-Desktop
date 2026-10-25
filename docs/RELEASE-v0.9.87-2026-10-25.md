# RiftLite v0.9.87 — published 25 October 2026

Windows, Mac Apple Silicon and Mac Intel are public and Latest. The user explicitly requested the version bump and desktop publication after testing the local candidate.

## Published scope

- Automatic completed Atlas replay collection adds All cards while preserving the original opening capture and Player view. Collection also handles verified completed BO1 games missing the usual ending signal; active-game requests stay deferred.
- Bounded mulligan metadata supports verified opponent kept cards and replacement draws. Returned identities that Atlas does not supply remain Unknown. The already-live website shows these summaries on Opening hands.
- All cards follows original replay access, is shared by default with an owner opt-out, and never includes private review notes. This website behavior was already published separately; this release adds the desktop collection support.
- Reduced background work during Atlas play: disabled tracker polling, overlapping diagnostics, unused CDP HTTP-body retention and repeated failed recovery scans. Active replay journals stage in local app storage before completed capture publication to the selected folder.
- Existing accounts, match history, decks, settings and recordings are preserved. Smooth user tests support improvement; the underlying transport stall was not conclusively identified, and no universal lag cure is claimed.

## Immutable publication

- Runtime: `8c780a9d7bf62da3aa58f59c2364c5154a5f6991`. Both desktop main branches were fast-forwarded. Tags `v0.9.87` and `mac-v0.9.87` remain pinned here; subsequent receipt commits are documentation only.
- [Windows release](https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.87) and [Mac release](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.87).
- [Native Mac build 40201883328](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/40201883328). Mac workflow now creates a draft and leaves Latest unchanged until native verification and downloaded-content parity are checked.
- Website remains runtime `8fa1f985d361c6956b9e704eab2c820269564fb9`, deployment `dpl_6moLoY6bkFyLLc2coEXHF7eyfQgf`. No website redeploy was performed.

## Verification

Fresh immutable Windows and native Mac builds each passed TypeScript, **3,138 tests (264 files)**, **82 account checks**, production build and packaging. Windows passed artifact validation and isolated hidden packaged startup/first-install UI checks. Native Mac checked architecture-specific FFmpeg, both app signatures, both DMGs and packaged startup on the runner architecture. Both downloaded Mac archives match all **365 compiled files and 60 resources** in the verified Windows build. Downloaded Mac applications were inspected without execution on Windows. Mac signing remains ad hoc, without notarization.

All eight public assets were downloaded and verified by size/SHA256. Updater manifests passed size/SHA512 checks. Both Latest endpoints and all three website platform download links resolve to v0.9.87. Previous v0.9.86 release metadata, tags and assets remain unchanged.

Windows installer: `../release-v0.9.87/release/RiftLiteBetaInstall.exe`, **159,783,286 bytes**, SHA256 `c5e92022a3a815c1ad2480d315265380aebb361f1b03e8f49c3a919123c4b027`. The public download exactly matches this build.

Evidence: `output/release-v0.9.87-final/` contains source/gate, build/package, isolated first-install, native Mac, draft content parity, publication, public downloads and preservation receipts.

Before receipt edits, **108 older artifact files**, **757 unrelated desktop files**, all **783 website files**, website HEAD/refs/build info and the original next-env.d.ts bytes were verified unchanged. Existing uncommitted historical documentation and previews remain. No installation, real-profile launch, Discord announcement, production replay rewrite or account-data mutation occurred. Opening Turns Lab and Replay Coach remain Coming soon; Your Move, Android and old candidates remain preserved.
