# RiftLite Post-v0.9.41 Handover - 2026-08-08

This is the authoritative handover for the v0.9.41 desktop release. Read it before older handovers, then use `docs/CURRENT_STATE.md` for longer architecture and release history.

## Release State

- Package/display version: `0.9.41`.
- Release source commit: `a84e9b0d971ca2b196dbeed0710183c1491d74f8` (`Release RiftLite v0.9.41`).
- Windows tag: `v0.9.41`.
- macOS tag: `mac-v0.9.41`.
- Windows release: `https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.41`.
- macOS release: `https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.41`.
- Native macOS workflow: `https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/31280797041` (success).
- Both tags dereference to the same immutable release source commit. Both repositories' `main` and `agent/release-v0.9.12` branches also contain the later publication-documentation commit; the release tags remain fixed on `a84e9b0`.
- Both releases are public, non-draft, non-prerelease, and the current latest release in their repository.

## Replay File Discovery

- Replay details now expose **Show in folder** and choose the best available local artifact in this order: recorded video, raw provider capture, imported `.riftreplay` bundle, then captured frame.
- The Web Replay section has a dedicated **Show source file** action for its local raw artifact.
- Renderer code sends only the replay ID and requested file kind. The main process resolves the path and checks the allowed kind, extension, managed storage root, file existence, and realpath containment before calling the operating-system reveal API.
- An external `.riftreplay` import can be revealed only when the stored replay record contains its original `importedAt` and `importedFrom` provenance.
- Symlink escapes and arbitrary renderer-supplied paths are rejected.

## Large Replay Export

- MP4 and clip export no longer inherit the old 384 MiB coaching-pack video ceiling. FFmpeg streams the source file, so long recordings are not rejected solely because of source size.
- FFmpeg receives a duration-aware timeout: at least 15 minutes, normally three times the replay duration plus five minutes, capped at six hours.
- Streamed v4 `.riftreplay` export accepts up to 8 GiB of video and 12 GiB total. The manifest remains capped at 512 MiB and individual encoded data lines at 2 MiB.
- Legacy whole-JSON bundles retain the prior 512 MiB bundle and 384 MiB embedded-video bounds.
- Bundle estimates include base64 expansion before writing. Large or unknown-size videos use the existing file-URL stream rather than copying more than 128 MiB through renderer IPC.

## Validation

- Focused replay/version validation passed 4 files / 21 tests.
- The final Windows release pipeline passed TypeScript lint, the 79-test account-sync gate, all 114 test files / 1,028 tests, the production build, installer/updater verification, executable and NSIS archive integrity checks, and isolated packaged-app smoke.
- The native macOS workflow passed the same source release gate plus Intel and Apple Silicon packaging, architecture-specific FFmpeg checks, updater/bundle identity validation, strict ad-hoc signature verification, DMG verification, and packaged-app smoke.
- Coverage validates the size policy, path-selection and containment helpers, IPC wiring, and normal replay paths. A literal multi-gigabyte export was not added to the automated suite; tester validation with a previously rejected long recording remains useful.

## Published Artifact Verification

Windows:

- `RiftLiteBetaInstall.exe`: 219,837,016 bytes; SHA-256 `3127B1629CAF0E5C6E9E83D7CE81F887F351D968003DC23D9E47FB6A5074D372`.
- `RiftLiteBetaInstall.exe.blockmap`: 207,178 bytes; SHA-256 `AA9EC0D9C6BE1C92617F0E75605FF5C6606D49B65B479BFB95D6D8E7CFD9865F`.
- `latest.yml`: 344 bytes; SHA-256 `3AD609AB67471DF4DB41415BEF7A9C86E4CC680AA89A8CD35F4421CA44E9ABAC`.

macOS:

- `RiftLiteBetaInstall-arm64.dmg`: 173,769,013 bytes; SHA-256 `3C93151984AC582AAB93F99EB94514B46FC82BF6596D96F6E2A72F7686ED07BF`.
- `RiftLiteBetaInstall-arm64.zip`: 166,351,803 bytes; SHA-256 `B3C6FB2FEC8F769555551FF1E89E7EB3F9B6699C122802E38F5C7A8DE6A66873`.
- `RiftLiteBetaInstall-x64.dmg`: 188,926,190 bytes; SHA-256 `927A7FA0A7F5D71F51D6B76F8A435597D5EA352BD2258BB7B95523D3059AA3D2`.
- `RiftLiteBetaInstall-x64.zip`: 181,252,134 bytes; SHA-256 `11FF09DB65CF03219A7DC3DF73A024A1053B82938E5FC444E64EDB738A6A07A4`.
- `latest-mac.yml`: 830 bytes; SHA-256 `2AA7063BEDDB20CB86E0ECC531E16A7A1215EBEEF1C8EC1B47E47228D1A902C2`.

All eight assets were downloaded into new temporary directories after publication and matched their GitHub sizes and SHA-256 digests. `latest.yml` and `latest-mac.yml` report version `0.9.41`; every referenced installer size and SHA-512 relationship matches the independently downloaded file.

## Known Mac Distribution Limitation

- macOS artifacts remain ad-hoc signed and are not notarized. Manual DMG installation and the one-time Gatekeeper **Open Anyway** flow remain expected.
- Automatic replacement from an older ad-hoc build is not reliable. A properly signed/notarized Developer ID bridge release is still required before Mac auto-update can be treated as supported.
- Keep the bundle ID stable. Users with an old version-named app or Dock shortcut may need to remove that old app bundle and launch `RiftLite Beta 0.9.app` directly from Applications.

## Continuity Constraints

Do not change these identifiers during ordinary updates:

- App ID: `com.riftlite.desktop.beta06`.
- Product/executable name: `RiftLite Beta 0.9`.
- User-data directory: `RiftLite Beta 0.6`.
- Media directory: `RiftLite`.
- Protocol: `riftlite`.
- Windows updater repository: `cdfpartridge-web/RiftLite-Desktop`.
- macOS updater repository: `cdfpartridge-web/RiftLite-Desktop-Mac`.

Always name the remote explicitly when pushing: `windows` is the Windows repository and `origin` is the macOS repository. Preserve user changes, do not stage `tmp/`, and never move the v0.9.41 release tags when adding later documentation.
