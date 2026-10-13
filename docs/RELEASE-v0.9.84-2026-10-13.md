# RiftLite v0.9.84 release — 13 October 2026

Windows **v0.9.84** and macOS **mac-v0.9.84** are public, non-prerelease and Latest. The user authorized the version bump and live update after the Atlas match logger fix.

Immutable runtime: **92e70e60dbb04d7d651ff60ffa90019e89b1dfce**, pushed to both desktop repositories and pinned by both new annotated release tags. Subsequent documentation does not change the binaries.

Atlas finished-board echoes no longer create a fresh logger when the next game starts. Delayed automatic review reads are cancelled before they can reopen a popup after a save, deferral, deletion or new game. Real rematches, BO3 continuation and manual review remain available. Includes v0.9.83's Atlas sign-in fix. [Investigation](./MATCH-LOGGER-2026-10-13.md) and [customer notes](./release-notes-v0.9.84.md).

## Verification

- Clean Windows source passed TypeScript, 82 account checks, **2,838 tests in 250 files**, production compilation, NSIS, installer/updater verification, isolated packaged startup and first-install Quick setup. The clean checkout used exact committed source bytes throughout.
- Windows package matched **349 compiled files** and **60 resources** exactly, including the finished-board fence, renderer cancellation guard, Atlas auth callback policy and version identity.
- Native Mac [run 38467488994](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/38467488994) passed its release gate, Intel/Apple Silicon packaging, FFmpeg architecture, strict signatures, identity/updater/DMG checks and isolated startup. Signing/notarization policy is unchanged.
- All eight public downloads and SHA256 digests, both updater sizes/SHA512 values, Latest endpoints and immutable source tags passed. Both downloaded Mac archives match the verified Windows compiled/runtime resources. Downloaded Mac applications were inspected, not executed on Windows.
- Windows published at **22:09:23 BST**; Mac at **22:06:15 BST**. Public verification completed at **22:10:07 BST**.
- Prior v0.9.83 releases/tags/assets and 63 older local/canonical artifact files were preserved. Existing dirty documents and website bytes remain preserved.

No website deployment was needed: all three website download buttons resolve to v0.9.84 through GitHub Latest. Opening Turns Lab, Replay Coach, Android and Your Move retain their existing state. No agent installation, real-profile launch or Discord announcement occurred.

## Artifacts

| Platform | File | Bytes | SHA256 |
| --- | --- | ---: | --- |
| windows | latest.yml | 344 | `aecb9a7cf3fdad11ff0f9f0f6a58c3938f89ebb9c1be479a9e87e7f56c3d463e` |
| windows | RiftLiteBetaInstall.exe | 159,745,864 | `90323dd5298549547638b305f15e5dcb2d9ee35168ec8e2c915804ade84a14cd` |
| windows | RiftLiteBetaInstall.exe.blockmap | 144,949 | `a32eff0ee1953fa849c40bfbb8f25038606c5fa3664adf57174e9bc6794275a9` |
| mac | latest-mac.yml | 830 | `b2c2f38568bac9a8645df2c935c38b221df2eaaecf7d763c8b81736a491b74b0` |
| mac | RiftLiteBetaInstall-arm64.dmg | 178,083,966 | `8c64a088f0cdfc1cb3d9c738b5bc89ce73919e1826c3818a67ad935d88dd8121` |
| mac | RiftLiteBetaInstall-arm64.zip | 176,377,043 | `e6c7974230c63715157704c0d707a5f1a216406bd25c4ca37de5a9401d6b0c1d` |
| mac | RiftLiteBetaInstall-x64.dmg | 193,288,315 | `f9f359f855d1f93d32daf4001ed256cd9d5feb62d590c7a263b424376e151848` |
| mac | RiftLiteBetaInstall-x64.zip | 191,634,985 | `f7050371fd1c3410f25d6f25bf406cfa4c44ed63bca7d100a98919936cca9877` |

Downloads: [Windows](https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.84), [Mac](https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.84), [website](https://www.riftlite.com/download).

Clean checkout: sibling `release-v0.9.84`, detached at the immutable runtime. Windows installer: `release/RiftLiteBetaInstall.exe` in that checkout. Evidence: `output/release-v0.9.84-final/` in the active desktop worktree. Do not move tags, replace published assets or rerun the successful tagged build.
