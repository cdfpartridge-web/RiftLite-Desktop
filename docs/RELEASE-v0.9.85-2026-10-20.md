# RiftLite v0.9.85 release — 20 October 2026

Windows **v0.9.85** and macOS **mac-v0.9.85** are public, non-prerelease and Latest. The user reported that the local Atlas startup candidate fixed their issue, then authorized this version bump and publication.

Immutable runtime: **10156cb878df2856ff68e086365b1461a4963366**, pushed to both desktop repositories and pinned by new annotated release tags. Later documentation commits do not change these binaries.

## Changes

- Fixes speculative replay recording after Atlas deck-editor navigation: only a trusted game page can prearm direct capture, navigation cancels obsolete streams, and an actual match retries direct capture before using its fallback. Duplicate or stale asynchronous capture requests cannot retain obsolete streams.
- Includes the previously authorized inline Quick setup account and deck flow from the tested local installer. Browser sign-in returns to the same welcome screen; profile setup and Piltover Archive/text deck import remain inside Quick setup.
- Adds bounded, local Atlas renderer timing/image diagnostics and image/font/media/auth-host failure coverage. No cache reset or browser-cache policy change was made.

The user confirmed the candidate improved their first-game experience. Earlier evidence identified the recording fallback defect; isolated network/asset tests did not establish the precise cause of every reconnect. [Customer notes](./release-notes-v0.9.85.md).

## Verification

- Clean Windows checkout passed TypeScript, 82 account checks, **2,877 tests in 254 files**, production compilation, NSIS, installer/updater verification, isolated packaged startup and first-install Quick setup.
- Windows package matched **353 compiled files** and **60 resources** exactly. Committed source bytes were unchanged throughout the build.
- Native Mac [run 39464747323](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/39464747323) passed release gates, Intel/Apple Silicon packaging, FFmpeg architecture, strict signatures, identity/updater/DMG checks and isolated startup. Signing/notarization policy is unchanged.
- All eight public assets passed SHA256 checks; both updater manifests passed size/SHA512 checks. Both downloaded Mac applications match the verified Windows compiled/runtime resources. Downloaded Mac apps were inspected, not executed on Windows.
- Windows published at **18:26:32 BST**; Mac at **18:33:44 BST**. Public verification completed at **18:35:24 BST**.
- Prior v0.9.84 tags/releases/assets, 75 older local/canonical artifact files, unrelated dirty documents and website bytes were preserved.

All three website download buttons resolve to v0.9.85 through GitHub Latest; no website deployment was needed. No agent installation, real-profile launch or Discord announcement occurred. Opening Turns Lab, Replay Coach, Android and Your Move retain their existing state.

## Artifacts

| Platform | File | Bytes | SHA256 |
| --- | --- | ---: | --- |
| windows | latest.yml | 344 | `bd4389c9154e94c6ec9bcb500713c51790cc62182a9781600df06612563de678` |
| windows | RiftLiteBetaInstall.exe | 159,746,200 | `e3335911d70a219f15a6d9413d14f69ffc34529e6aa814c410c136f5e88327d6` |
| windows | RiftLiteBetaInstall.exe.blockmap | 144,152 | `e7f6919b3e584d94c582744f802924ea505a59532b9dfa8afa8ab32202402656` |
| mac | latest-mac.yml | 830 | `e4a71db240b0c81ff3e41838eb1eef14d7e1d65a5729bb33b0213107864c0ed8` |
| mac | RiftLiteBetaInstall-arm64.dmg | 178,101,451 | `e574def53699ccee213cbd118171849f9e929a3f47abc18b9277cf03bde5a0c6` |
| mac | RiftLiteBetaInstall-arm64.zip | 176,385,897 | `2b1450d86afaacc5e132b52c6d64349f328bb2c24609e46107aeead951418ab8` |
| mac | RiftLiteBetaInstall-x64.dmg | 193,294,367 | `59a904ac57f84a45d7ccd757f45cc332cb91b78b42bc783543b626914c264417` |
| mac | RiftLiteBetaInstall-x64.zip | 191,643,844 | `6b9d25dadcf57e00924752d936d665e0050efd12531d28941e919575809eb0e2` |

Downloads: [Windows](https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.85), [Mac](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.85), [website](https://www.riftlite.com/download).

Clean checkout: sibling `release-v0.9.85`, detached at the immutable runtime. Windows installer: `release/RiftLiteBetaInstall.exe` in that checkout. Evidence: `output/release-v0.9.85-final/` in the active desktop worktree. Do not move tags, replace published assets or rerun the successful tagged build.
