# RiftLite v0.9.93

Published on 23 November 2026 for Windows x64, Mac Apple Silicon and Mac Intel. The desktop app uses Electron 43.8.12 to improve responsiveness when selecting cards during an Atlas Showdown. [Download RiftLite](https://www.riftlite.com/download) · [Windows release](https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.93) · [Mac release](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.93)

## Verification

- Windows and native macOS each passed 3,928 tests in 296 files, including 150 separately checked account tests. Both tags point to `e507c993bf2e54fa44d18d827d2277ea4de37bbd`. [Native Mac build](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/45204893903)
- The packaged Windows app captured all three games of a simulated 2–1 match with video and game audio. The replay and marked decision were still present after restarting. An existing v0.9.92 test profile kept its game scores, match note, linked replay and recording preference after opening in v0.9.93.
- Both Mac packages passed signature, FFmpeg architecture and disk-image checks. All 408 compiled files and 67 resources matched the Windows build in both Mac archives.
- Both public updater feeds served v0.9.93. All eight published assets matched their expected digests and all three download links reached the new installers. The Windows installer is 177,780,288 bytes with SHA-256 `740fd784b2206633f7468ec8624c3ebc8ad5f5c5dc3f4b37a46ed5ab74ab3f7c`.

Local receipts are in `output/release-v0.9.93-20261123/`.
