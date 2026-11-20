# RiftLite v0.9.90

Published 20 November 2026 for Windows, Mac Apple Silicon and Mac Intel. Both GitHub releases are marked Latest. [Public downloads](https://www.riftlite.com/download) · [Windows release](https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.90) · [Mac release](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.90)

Open Learn Riftbound from the left menu to follow Your path. The course includes 40 guided lessons, 920 actions, 28 keyword scenarios and 51 optional quiz questions. This release also includes the Atlas replay and capture improvements, deck notebook and decision-marker fixes, phone Scorepad import changes and account sync improvements. [Player-facing release notes](./release-notes-v0.9.90.md)

## Verification

- A fresh Windows profile opened Your path and showed all 40 lessons. Closing the packaged app and reopening it restored the exact two saved actions and the same guided move. [Packaged course check](../output/release-0.9.90-qa-20261120/packaged-course-smoke.json)
- Both annotated release tags point to `abbab2aca123e0523f2c21bf87e496391447e7e2`. Windows and macOS release gates each passed 3,923 tests in 295 files, including 150 account checks. [Native Mac build](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/44741510516)
- Both Mac archives matched the Windows build across all 408 compiled files and 67 resources. Packaged startup passed on Windows and Apple Silicon. The Intel build received architecture, signing and content checks. The Mac beta uses ad hoc signing and requires manual installation from the DMG.
- All eight public assets were downloaded and checked against their SHA-256 digests. Both update manifests matched the actual file sizes and SHA-512 digests. The Windows installer is 167,048,116 bytes with SHA-256 `38ae01339fa099fcb6af0081b69a659676962e60698f1b684527c647005666d4`. [Public asset verification](../output/release-v0.9.90-20261120/public-verification.json) · [Website download checks](../output/release-v0.9.90-20261120/latest-download-links.json)
- The release used a separate build worktree and isolated startup profiles. Prior v0.9.89 tags, release assets, the accepted local installer, previous launcher and existing development build were verified. [Preservation checks](../output/release-v0.9.90-20261120/preservation-verification.json)
