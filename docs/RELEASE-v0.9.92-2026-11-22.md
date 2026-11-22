# RiftLite v0.9.92

Published on 22 November 2026 for Windows, Mac Apple Silicon and Mac Intel. The website’s three download links resolve to this version. [Download RiftLite](https://www.riftlite.com/download) · [Windows release](https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.92) · [Mac release](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.92)

The 10 Basics topics, 40 guided lessons, 28 keyword scenarios, optional quiz and deck guides use the revised explanations. The course keeps the opening-hand lesson’s conversational style and asks why you might choose a particular play. The app also includes the Chain, Hidden card, menu, drawer and small-screen control fixes. [Player-facing release notes](./release-notes-v0.9.92.md)

The main Learn Riftbound page serves the same course. All 213 public web course files on deployment `dpl_GZFVxM4tjWJfo74ucWVB1U3R8VCL` matched the reviewed build, and Chrome resumed an opening-hand checkpoint saved before publication. The separate tester remains on its previous release. [Learn Riftbound](https://www.riftlite.com/learn-riftbound)

## Verification

- Windows passed 3,928 tests in 296 files and 150 account checks. Native macOS passed 3,928 tests in 296 files and 150 account checks. Both release tags point to `a18f3f9fd8ef40c493a9bdb307566dc25f67e515`. [Native Mac run](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/45012414863)
- Windows packaged startup and both first-run choices passed. Every compiled file (408) and resource (67) matched across the Windows and two Mac archives. Both Mac architectures passed signature and disk-image checks. The packaged app started on the native Mac runner.
- The v0.9.90 upgrade check covered 998 saved checkpoints across 40 lessons, with 956 moves across the available routes, 10 Basics topics and 51 quiz answers.
- Both public releases are marked Latest. All eight public assets matched their SHA-256 digests and both update manifests matched the public file sizes and SHA-512 digests. The Windows installer is 167,047,077 bytes with SHA-256 `cb036a644f75873383c46832b5061a9b936dc9e1c55961ee931142d74c44a0f2`.
- The v0.9.91 candidate failed its release checks and never became the public download. The prior v0.9.90 releases and assets were checked after v0.9.92 went live.

The maintainer’s local verification receipts are under `output/release-v0.9.92-20261122/`, including `public-verification.json` and `latest-download-links.json`.
