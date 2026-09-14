# Start here — RiftLite engineering

**Published desktop release — v0.9.74, 2026-09-14:** Windows and macOS Intel/Apple Silicon are live and Latest from immutable source `a40a580539f200a00563450d46660642c9c9ae83`. [Release and verification receipt](./RELEASE-2026-09-14.md). Includes the Prepare/Review refresh, Atlas automatic opponent decks and popup/chat fixes, bulk Keep local, movable Mark decision, BO3/data/plan/battlefield improvements and Electron 39.8.10. **214 files / 2,198 desktop tests**, **82 sync checks**, native Mac signatures/packaging/startup, Windows packaged startup, all **8 public asset/updater checks** and **298 matching compiled files per platform** passed. Canonical `release/RiftLiteBetaInstall.exe` is **159,374,976 bytes**, SHA-256 `3CC27FEC249438B4504675C3EE61E406592229AC81E3F381DB3B03CACE8EE56E`; prior files are backed up in `output/release-v0.9.74-runtime-final/previous-canonical-0.9.73/`. Canonical dependencies match the patched runtime. Mac remains ad-hoc signed, not notarized. Signed-in gameplay/chat/deck-import acceptance remains pending. Android and Your Move remain separate; older notices below describe their dated checkpoints.

Last updated: 2026-09-14

**Public v0.9.73, 2026-09-06:** Windows **v0.9.73** and macOS **mac-v0.9.73** are published and Latest from immutable source **`2edbeadd92971d3f35f62a45a10faf4acdb26ada`**. Both platforms passed TypeScript, the 82-test account-sync gate and **200 files / 2,052 tests**, fresh packaging and isolated startup. All eight public assets/updater hashes were verified, and both downloaded Mac architectures contain the same 282 compiled files as the verified Windows build. Canonical `release/RiftLiteBetaInstall.exe` is the new 159,349,815-byte public installer, SHA-256 **`EF61456759A97C64B88C68E7230850BDBD62A2AD716910F1A392B328BDC70CB7`**. Read [the completed release record](./RELEASE-2026-09-06.md) first. Replay Coach stays hidden; website work remains separate and undeployed; signed-in saving and live gameplay acceptance remain pending. The app was not installed during publication. Earlier paragraphs below describe their dated artifacts.

**Latest local installer — Atlas deck editing, 2026-09-06:** Edit Deck stays in the client with **Back to Play** and native unsaved-change handling. The user-authorized candidate completed at **15:01 BST** in `output/local-atlas-deck-20260906-1456`. **200 files / 2,052 tests**, TypeScript, clean build, packaging, artifact verification, isolated startup and the **282-file package audit** passed. Installer: **159,349,611 bytes**, SHA-256 `4B34447A525680CE68C4C715FF72C47D8DE3DBF5E2AF4249D7E8D271AD3EE1A0`. It retains v0.9.72, includes all earlier local desktop fixes, keeps Coach hidden, and is neither installed nor published. See [Atlas deck navigation continuation](./ATLAS-DECK-NAVIGATION-2026-09-06.md).

**Latest checkpoint — Coach parked, 2026-09-06:** At the user's request, Replay Coach is hidden again behind Coming Soon. Its implementation, saved journal, practice trials and session state are preserved. The replacement local candidate completed at **11:33 BST** in `output/local-coach-hidden-20260906-1130`, with **197 files / 1,995 tests**, TypeScript, clean build, packaging, artifact checks, isolated startup and the 278-file package audit passing. The 159,347,244-byte installer has SHA-256 `0F63A420DDA0F83C1E639554B13D83FB4E7865C4B1C70C3D1C6CF856A55A91BB`. It retains version 0.9.72 and is not installed or published. The earlier **10:54 BST installer still contains enabled Coach** and is preserved separately. See [Replay Coach continuation](./REPLAY-COACH-2026-09-06.md).

**Earlier implementation and local build checkpoint:** Replay Coach was implemented with real evidence, player reflections, persistent practice trials and a journal. The user-authorized local Windows candidate completed at **10:54 BST** in `output/local-replay-coach-20260906-1035`, including all earlier desktop maintenance and signed-artwork changes. **197 files / 1,995 tests**, clean production build, packaging, artifact checks, isolated startup and a 278-file package audit passed for that candidate. The 159,365,771-byte installer has SHA-256 `A5E7CC6112E4C91C70150337DB4CCBAA830AEBC19BAA37E4D6C805F868CD0988`. It retains version 0.9.72, is not installed or published, and supersedes the earlier local candidates below. Public assets and website deployments remain unchanged; live gameplay validation remains pending.

**Earlier artwork checkpoint:** [Card artwork audit, 2026-09-05](./CARD-ART-AUDIT-2026-09-05.md). Local desktop and website changes add all nine missing signed Vendetta prints, correct the default Shadowblade Lurker image, and preserve alternate/signed artwork through rendering and website ingestion. The registry matches all 1,189 prints / 45 signed variants in the audited Riot gallery. Desktop changes are included in the new local Coach candidate above; website changes remain undeployed. All source changes remain uncommitted and must be preserved.

Public release, 2026-09-04: Windows **v0.9.72** and macOS **mac-v0.9.72** remain live and Latest from immutable source commit `1926772`. Maintenance checkpoint `23893a6` contains the dedicated Atlas Player-name fallback, reviewed maintenance improvements and renderer-output cleanup. A subsequent **uncommitted source follow-up** adds complete build-output cleanup and extracts deck-comparison/MP4 render logic; its **192 files / 1,903 tests**, clean production build and isolated production startup passed at **22:49 BST**. [The maintenance record](./MAINTENANCE-2026-09-04.md) distinguishes both checkpoints. The latest **local Windows installer** is still the 159 MB candidate completed at **22:35 BST** in `output/local-maintenance-clean-20260904-2232`; it does not include the later source follow-up. Live gameplay validation remains explicitly pending. The canonical `release/` installer and public assets remain unchanged. Preserve the current source changes and five separate historical untracked entries.

This is the shortest safe entry point for a new Codex chat. Read the completed v0.9.73 release record first, then the Atlas deck navigation continuation for behaviour details; the dated Coach, maintenance and artwork paragraphs describe earlier checkpoints.

## Read in this order

1. [Completed v0.9.73 release](./RELEASE-2026-09-06.md) — immutable source, Windows/macOS builds, public hashes, verification and remaining acceptance. Read completely.
2. [Atlas deck navigation](./ATLAS-DECK-NAVIGATION-2026-09-06.md) — in-client deck editing, return control and unsaved-change behaviour included in v0.9.73.
3. [Maintenance checkpoint](./MAINTENANCE-2026-09-04.md) and [Atlas continuation handover](./HANDOVER-2026-09-04.md) — repair evidence and implementation history now included in v0.9.73.
4. [Detailed project handover](./HANDOVER-2026-08-30.md) — architecture, implemented features and historical acceptance work. Dated sections describe their own checkpoints.
5. [v0.9.73 release notes](./release-notes-v0.9.73.md) — current customer notes. The older v0.9.72 Player-field limitation is described in the Atlas handover.
6. [Web Replay system handover](./WEB_REPLAY_SYSTEM_HANDOVER.md) — when working on Web Replays, raw capture, or replay upload/delivery.
7. [Long-form engineering history](./CURRENT_STATE.md) — historical architecture and release history; its older status sections are not current operational truth.

Task-specific references:

- [Your Move local creator workspace](./YOUR-MOVE-2026-09-06.md) — complete local creation, preview, sharing and embed sequence at port 4180, corrected RiftLite branding, saved examples and restart instructions. Local implementation is authorized; production deployment remains unrequested.
- [Account onboarding](./account-onboarding.md) and [account cloud sync](./account-cloud-sync.md)
- [Replay V2 desktop](./replay-v2-desktop.md), [Web Replay system](./WEB_REPLAY_SYSTEM_HANDOVER.md), and [TCGA Web Replay monitor](./TCGA_WEB_REPLAY_MONITOR.md)

## Active desktop repository

```text
C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06
```

Branch: `hotfix/atlas-shell-recovery`

Release source: `2edbeadd92971d3f35f62a45a10faf4acdb26ada`, followed by a documentation checkpoint recording publication. Use `git rev-parse HEAD` for the current documentation commit. All intended desktop maintenance, artwork, parked-Coach and deck-navigation work is committed. Current source/artifact fingerprints are in `output/release-v0.9.73-final/`; earlier maintenance and local-candidate evidence is preserved in its dated output directories.

Public release: `2edbeadd92971d3f35f62a45a10faf4acdb26ada` / v0.9.73. Previous v0.9.72 source remains fixed at `19267728332ebb9c946d7a61d03715c149400589`.

If the new chat opens in `C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\RiftLite`, change to the active desktop path above before running desktop commands. The legacy folder is not the Electron repository.

## Three things not to get wrong

1. Preserve the committed desktop release work. Five separate historical untracked entries remain: three v0.9.70 documents, `tmp-app-diff.txt`, and `tmp/`. Do not reset, checkout, clean, stage, publish, or overwrite those historical entries; `tmp/` may contain sensitive browser state.
2. Replay Coach is parked behind Coming Soon; keep its implementation and data intact. Search Rules remains disabled. Windows `v0.9.73` and macOS `mac-v0.9.73` are immutable at `2edbead`; never move their tags, replace their assets, or rerun successful tagged Mac job `34054813317`. Older published releases also remain immutable.
3. The deployed website remains at `135d239`. Its correct worktree has uncommitted, undeployed card-artwork and Your Move work. Preserve all 16 entries and local demos; this desktop release did not deploy them. The older primary website checkout is still not the right place to resume replay work without first synchronising it.

## Verify the handover has not drifted

From the active desktop repository, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\print-handover-state.ps1
```

The script is read-only. It prints the current desktop branch, commit, dirty files, package version, local installer hash, relevant website worktree state, and common development ports.

Compare its output with `docs/RELEASE-2026-09-06.md`. The snapshot hashes the canonical public `release/` installer, which now matches v0.9.73. The verified clean build and unpacked apps are in the isolated checkout named by the release record; old canonical build folders are not fresh release output. Trust live repository state if it differs materially. The script's final link still points to the detailed historical handover; the current release checkpoint is linked above.

## New-chat prompt

> Continue RiftLite from `C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06`. Read `AGENTS.md`, `docs/START_HERE.md` and `docs/RELEASE-2026-09-06.md`, then run the read-only snapshot and inspect Git status. Windows v0.9.73 and macOS mac-v0.9.73 are public and Latest from immutable source `2edbeadd92971d3f35f62a45a10faf4acdb26ada`; current HEAD may be the later documentation checkpoint. All intended desktop changes are committed. Both platforms passed 200 files / 2,052 tests and their native release gates; all eight public assets/updaters and both downloaded Mac packages were verified. Canonical `release/RiftLiteBetaInstall.exe` is 159,349,815 bytes, SHA-256 `EF61456759A97C64B88C68E7230850BDBD62A2AD716910F1A392B328BDC70CB7`. It includes Atlas Player-name repair, in-client deck editing/Back to Play, signed artwork and maintenance. Coach remains hidden. Preserve the five historical untracked entries, old candidates and separate website artwork/Your Move work. Website source remains undeployed; signed-in saving and live gameplay acceptance remain pending. Do not move tags, replace assets, rerun successful Mac job 34054813317, rebuild, install or publish again until asked. Briefly confirm state, then continue with my next request.
