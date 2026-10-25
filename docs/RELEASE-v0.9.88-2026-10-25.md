# RiftLite v0.9.88 — published 25 October 2026

Windows, Mac Apple Silicon and Mac Intel are public and Latest. The user explicitly authorized rebuilding, bumping the version and going live after the BO3 All cards investigation.

## Changes

- Completed Atlas BO3 series missing individual game-ending fields now supply exact completion-check candidates. Shared series, participants, game identities, contiguous authoritative capture and coherent terminal series wins are required. Atlas must independently return each owned, unrestricted completed game; no winner or ending timestamp is fabricated.
- Finished-board snapshots no longer recreate an active capture when saved and provider champion labels differ. At most the exact saved/terminal labels are retained; existing room, opponent, game identity, history, score and new-game boundaries stay enforced.
- Original replay captures, opening hands, Player view, sharing preferences and private notes remain intact. Full findings: [BO3 investigation](./ATLAS-BO3-ALL-CARDS-2026-10-25.md).

The four original affected captures now yield all ten correct game candidates, previously only one. The actual-shape finished-board regression failed before and passes after. This is source/regression evidence; live Atlas retrieval and rendered All cards for those games after installing this release remain for the user to verify. Fully restart after updating and leave signed-in Atlas at the lobby briefly; eligible recent Ready replays can retry within six hours, subject to Atlas availability and permissions.

## Immutable release

- Runtime: `09fd90ed530a552a3cd9f8bd90468c4d43a53fc4`; tags `v0.9.88` and `mac-v0.9.88` remain pinned here. Both desktop main branches were fast-forwarded; later receipt commits are documentation only.
- [Windows release](https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.88) and [Mac release](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.88).
- [Native Mac build 40213618176](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/40213618176). Both releases stayed draft until all package checks and Mac/Windows content comparisons passed.
- Website unchanged at runtime `8fa1f985d361c6956b9e704eab2c820269564fb9`, deployment `dpl_6moLoY6bkFyLLc2coEXHF7eyfQgf`; no website redeploy.

## Verification

Fresh immutable Windows and native Mac builds each passed TypeScript, **3,184 tests in 264 files**, **82 account checks**, production compilation and packaging. Windows passed artifact/updater/blockmap checks and isolated hidden packaged startup/first-install UI. Native Mac passed both architectures/FFmpeg/signatures/DMG checks and packaged startup on the runner architecture. Mac remains ad hoc signed, without notarization.

Both downloaded Mac archives exactly match all **365 compiled files and 60 resources** of the verified Windows build. All eight public assets were downloaded and checked by size/SHA256; update manifests passed size/SHA512 checks. Both Latest endpoints and the three website platform download links resolve to v0.9.88. Previous v0.9.87 release metadata, tags and assets are unchanged.

Windows installer: `../release-v0.9.88/release/RiftLiteBetaInstall.exe`, **159,783,482 bytes**, SHA256 `9a115623b9f1bb20603ac86a5cbd90a28e517a03fd7c304c0fe476173accc5b4`. It exactly matches the public download. Evidence: `output/release-v0.9.88-final/`.

**111 older artifact files**, **776 unrelated desktop files**, all **783 website files**, website HEAD/refs/build info and original next-env.d.ts bytes were verified unchanged before receipt edits. All pre-existing dirty/untracked historical notes and preview files remain. No installation, real-profile launch, Discord announcement, production replay rewrite or account-data mutation occurred.
