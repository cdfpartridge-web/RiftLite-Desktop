# RiftLite Post-v0.9.12 Handover - 2026-07-27

This is the authoritative continuation point for a new Codex chat. Read `docs/CURRENT_STATE.md` after this file for the longer architecture and release history. The older handovers remain useful history but are no longer the current working-tree guide.

## Executive Summary

- Windows `v0.9.12` is already published from commit/tag `50d6130`.
- macOS production remains `mac-v0.9.11`.
- The desktop package version is still `0.9.12`, but the local desktop worktree now contains five tested post-release changes:
  1. private-hub owner/co-owner member removal;
  2. Atlas room-boundary and finalized-result-echo repairs for missing/ghost matches;
  3. Atlas empty-shell recovery that clears its disposable runtime before reloading and cannot leave the user trapped behind the startup cover;
  4. Windows replay MP4 export now burns in flags, notes, and drawings instead of silently producing a clean video;
  5. Atlas WebSocket reveals now feed an ephemeral, exact-instance known-opponent-hand panel with real card art and manual/automatic removal.
- These post-release changes are local and uncommitted. They were not pushed, tagged, published, or deployed. They were rebuilt into one local-only v0.9.12 installer on 2026-07-28.
- The complete current desktop source passed TypeScript, all 97 test files / 836 tests, the production build, Windows artifact verification, and both development and packaged Electron smoke tests.
- Do not reset or clean either the desktop or website worktree. Both contain intentional uncommitted work.

## Canonical Repositories

Desktop:

`C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06`

Website:

`C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\RiftLite-website`

Do not accidentally work from the older application at:

`C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\RiftLite`

## Desktop Release And Branch Truth

| Item | State |
| --- | --- |
| Local branch | `agent/release-v0.9.12` |
| Local HEAD | `50d6130` (`Release RiftLite 0.9.12`) |
| Windows tracking branch | `windows/agent/release-v0.9.12` |
| Windows public release | `v0.9.12` |
| Windows remote | `windows` -> `cdfpartridge-web/RiftLite-Desktop` |
| macOS public release | `mac-v0.9.11` |
| macOS remote | `origin` -> `cdfpartridge-web/RiftLite-Desktop-mac` |
| Current package version | `0.9.12` |

The local installer was rebuilt from the complete dirty worktree on 2026-07-28:

- path: `release\RiftLiteBetaInstall.exe`
- size: `202,544,321` bytes
- SHA-256: `FEC7423CB30AAB68EAD741EE6E78FD83ED5CA688FE8EA61C031D61C4F0181B5A`
- timestamp: `2026-07-28T22:06:30.6646120+01:00`
- product/file version: `0.9.12`
- Authenticode status: not signed
- blockmap: `188,431` bytes, SHA-256 `7CDCAEAB4BBBD177CF98D1105ABB0C2B0D8F54D8C36A0932516DB4E5D13904D5`
- `latest.yml`: `344` bytes, SHA-256 `B25F90448466632AEB4C1BC57DCD9DA6D9B110EFEBC45DF973BD3EBCEE532686`

This local installer contains all five post-release changes, but it is not the public v0.9.12 artifact and was not uploaded anywhere. Because `v0.9.12` is already published, the natural next public release is a new version such as `v0.9.13`; do not overwrite or move the existing v0.9.12 tag.

## Hard Continuity Rules

Preserve:

- app ID `com.riftlite.desktop.beta06`
- user-data directory `%APPDATA%\RiftLite Beta 0.6`
- media directory `RiftLite`
- deep-link protocol `riftlite://`
- Windows updater repository `cdfpartridge-web/RiftLite-Desktop`
- macOS updater repository `cdfpartridge-web/RiftLite-Desktop-Mac`
- installer name `RiftLiteBetaInstall.exe`
- existing accounts, cloud identity aliases, matches, decks, replay associations, raw captures, Discord settings, and local storage paths

Before changing anything:

1. Run `git status --short --branch`.
2. Read the relevant diff, not only the committed source.
3. Preserve all unrelated changes.
4. Do not run broad reset, checkout, clean, formatting, or staging commands.
5. Do not build installers, deploy, push, tag, publish, send Discord messages, or mutate production data without explicit user approval.

## Post-release Desktop Fix 1: Private-Hub Member Removal

The desktop now exposes the existing authenticated website member-removal route.

Authority matrix:

- owner can remove a member or co-owner;
- owner cannot remove the owner record;
- co-owner (`admin`) can remove a regular member;
- co-owner cannot remove the owner or another co-owner;
- regular members cannot remove anyone.

The renderer applies the same policy for visibility, but the website remains the security authority. Its route is:

`src/app/api/hubs/[hubId]/members/[uid]/route.ts`

That server route calls `assertHubCapability(..., "manage_members")` and `assertHubMemberRemovalAllowed`, resolves identity aliases, protects the owner, and deletes the matching membership records. Do not weaken the server checks even though the desktop hides unauthorized controls.

Desktop files:

- `src/main/main.ts`
- `src/main/services/firebaseSync.ts`
- `src/preload/appPreload.ts`
- `src/renderer/App.tsx`
- `src/shared/privateHubs.ts`
- `src/shared/types.ts`
- `tests/ipcRegistrationSecurity.test.ts`
- `tests/privateHubLifecycle.test.ts`
- `tests/privateHubs.test.ts`

The UI confirms the removal, disables concurrent member actions, updates the local list after success, and refreshes Hub Health.

## Post-release Desktop Fix 2: Atlas Missing And Ghost Matches

Tester report:

- Windows v0.9.12;
- in a multi-game Atlas sequence, an earlier game was not recorded;
- a later entry appeared as an `Unknown` matchup, with the tester's Lillia side becoming unknown.

Two lifecycle failures were addressed.

### Reliable room changes while Atlas remains active

Atlas can move from one room/game to another before the 1.8-second inactive debounce fires. Previously, `previousActive` stayed true and the preload did not emit a new `match-start`.

The new `isAtlasActiveRoomBoundary` helper accepts a boundary only when:

- both previous and next snapshots are active;
- both contain valid 3-16 character alphanumeric room codes;
- the normalized room codes differ.

On that boundary the preload:

- emits a new `match-start` with reason `atlas-room-changed`;
- resets the carried active snapshot;
- remembers the new room;
- resets the remembered room after the normal inactive end.

This is Atlas-only and does not change TCGA lifecycle logic.

### Finalized result echo after BO3 review flush

The active result snapshot that releases a pending BO3 review could then fall through into a newly empty tracker and seed a ghost match. The coordinator now detects and ignores that one finalized Atlas `game-result`/confirm-winner echo after the pending review is flushed. It records a privacy-safe debug event:

`atlas-finalized-result-echo-ignored`

A genuinely new active snapshot still starts the next match normally.

Files:

- `src/game-preload/gamePreload.ts`
- `src/main/services/captureCoordinator.ts`
- `src/shared/atlasCaptureLifecycle.ts` (new)
- `tests/atlasCaptureLifecycle.test.ts` (new)
- `tests/captureCoordinator.test.ts`

## Post-release Desktop Fix 3: Atlas Empty-Shell Startup Recovery

Tester screenshot:

- RiftLite displayed the outer RiftAtlas page and adverts;
- the lobby application itself was empty;
- the center cover remained on `Starting RiftAtlas`.

### Root cause

The preload correctly identified an empty Atlas application shell. Two one-shot recovery mechanisms then raced:

1. the renderer immediately destroyed/remounted the guest;
2. the main process had scheduled a fail-safe reload of that original guest.

Destroying the guest cancelled the main repair while still consuming the recovery budgets. More importantly, neither path cleared the stale service worker/Cache Storage state that the existing manual **Repair Atlas** action was designed to fix.

### Current fix

- The renderer no longer destroys the guest after the first empty-shell signal.
- The main process owns the automatic recovery.
- It clears only Atlas's disposable runtime layers:
  - code cache;
  - HTTP cache;
  - service workers;
  - Cache Storage;
  - open connections.
- It preserves:
  - cookies and Atlas sign-in;
  - local storage;
  - IndexedDB/local decks;
  - RiftLite account, settings, matches, decks, captures, and replays.
- It rechecks that the same trusted Atlas guest is still current and no Atlas match is active before reloading.
- Automatic and explicit repair calls coalesce through one in-flight recovery promise.
- The startup cover now provides:
  - **Repair now**;
  - **Show Atlas now**.
- The existing bounded fail-open remains, so a future Atlas markup change cannot permanently trap the user behind the cover.

Files:

- `src/main/main.ts`
- `src/renderer/App.tsx`
- `src/renderer/styles/app.css`
- `src/shared/atlasWebviewRecovery.ts`
- `tests/atlasWebviewRecovery.test.ts`
- `tests/atlasEmptyShellRecoveryIntegration.test.ts` (new)

The integration test deliberately verifies that the renderer empty-shell handler does not call `setGameWebviewEpoch`, and that main-process runtime repair occurs before `reloadIgnoringCache`.

## Post-release Desktop Fix 4: Replay MP4 Flag And Drawing Burn-In

Tester report:

- Windows v0.9.11;
- replay flags and notes were saved while reviewing a video;
- MP4 export completed, but the result contained only the clean game recording.

### Root cause

The exporter generated each flag or drawing as SVG, then passed the SVG data URL to Electron `nativeImage`. On Windows/Electron 39, that returns an empty `0x0` image. The exporter caught the error, silently skipped every overlay, and let FFmpeg create a valid plain MP4.

The supplied diagnostics confirm v0.9.11 and repeated `save-replay` operations immediately before the long export, but older builds did not record MP4 overlay preparation. A direct Windows probe reproduced the empty `nativeImage`, while loading the same SVG in a hidden Chromium window and calling `capturePage()` produced the expected transparent PNG.

### Current fix

- One hidden, sandboxed, transparent Chromium window is reused to rasterize all selected overlays in an export.
- The window cannot execute JavaScript, open child windows, appear in the taskbar, or receive focus.
- Overlay rendering failure now aborts the export instead of silently returning an unannotated MP4.
- Temporary overlay files created before a later render failure are removed.
- Older replay/frame flags without an explicit `timeMs` derive their video position from `capturedAt` instead of being silently excluded.
- Timed flags remain visible in the upper-left for approximately 4.5 seconds; drawings retain their existing 3.5-second duration and text annotations their 5-second duration.

Files:

- `src/main/main.ts`
- `src/main/services/replayMp4OverlayRasterizer.ts` (new)
- `tests/replayMp4OverlayRasterizer.test.ts` (new)

## Post-release Desktop Feature 5: Atlas Known Opponent Hand

The user asked for a way to remember cards after an in-game effect temporarily reveals the opponent's hand. The screenshot-based fallback was not needed: the existing Atlas WebSocket feed includes exact card identities during a legitimate reveal.

### Protocol and privacy boundary

The new `AtlasKnownOpponentHandTracker` is intentionally strict:

- it reads only incoming `authoritative_patch_commit` frames from the already-validated Atlas ingest;
- it learns the local seat from trusted session/URL evidence or an outbound local action;
- it accepts a reveal only when the same authoritative patch:
  - sets `handRevealToOpponent: true` for exactly one non-local player; and
  - supplies real, non-placeholder cards for that player's hand;
- it keeps duplicate prints as separate cards by exact Atlas instance ID;
- it fails closed when the viewer is a spectator, local identity is missing/conflicting, the frame is outbound, the packet is only a snapshot, or the cards are placeholders;
- concealment retains the remembered identities and separately records the current total hand size, so the UI can truthfully show states such as `5 known · 6 cards currently in hand`;
- exact moves out of hand, public zone insertions, and chain source IDs remove the matching known instance automatically;
- exact returns to hand are restored, including unambiguous hidden returns from a public zone or a remembered chain entry;
- a subsequent exact reveal reconciles the set;
- game/room changes, accepted Atlas `match-end`, `room_shell_leave`, destruction of the current Atlas guest, and same-room spectator/seat transitions clear it and its local-seat authority.

The state is in-memory only. The renderer receives a frozen, sanitized card model rather than raw WebSocket packets, and the feature is independent of the optional deck tracker. It never infers an unknown card identity.

If Atlas reports an anonymous hidden departure, the tracker may retain more remembered possibilities than there are current hand slots because it cannot safely choose which identity left. The UI labels these as possibilities and asks the user to dismiss one only when they can identify it.

### User experience

- An Atlas-only eye button sits in the top play toolbar.
- Its badge shows the number of remembered exact cards.
- Clicking it opens a right-side panel over the game with the actual bundled card art.
- Clicking a card marks that exact instance as gone; **Clear all** removes the full remembered set.
- Unmodified `F12` toggles the panel even while the Atlas guest owns focus.
- If another RiftLite action already has `F12` registered, that action retains priority and the toolbar tooltip explains the conflict.
- Closing the panel returns keyboard focus to Atlas.

### Capture verification

A local read-only audit parsed 105 stored Atlas raw-capture documents without error. Ten files contained qualifying player-view reveals, the largest remembered hand contained seven exact cards, and no spectator capture produced remembered card data.

The screenshot-matching capture reproduced the expected sequence:

- four exact cards captured at the reveal;
- one exact card removed when Atlas showed it leaving the hand;
- three cards retained when the hand became hidden again;
- later exact chain/public-zone evidence removed the remembered instances.

Files:

- `src/main/main.ts`
- `src/preload/appPreload.ts`
- `src/renderer/App.tsx`
- `src/renderer/styles/app.css`
- `src/shared/atlasKnownOpponentHand.ts` (new)
- `src/shared/types.ts`
- `tests/appWindowLifecycle.test.ts`
- `tests/atlasKnownOpponentHand.test.ts` (new)
- `tests/atlasKnownOpponentHandIntegration.test.ts` (new)
- `tests/ipcRegistrationSecurity.test.ts`
- `tests/uiDevModernStyles.test.ts`

## Exact Desktop Working Tree

Tracked modifications:

```text
src/game-preload/gamePreload.ts
src/main/main.ts
src/main/services/captureCoordinator.ts
src/main/services/firebaseSync.ts
src/preload/appPreload.ts
src/renderer/App.tsx
src/renderer/styles/app.css
src/shared/atlasWebviewRecovery.ts
src/shared/privateHubs.ts
src/shared/types.ts
tests/atlasWebviewRecovery.test.ts
tests/appWindowLifecycle.test.ts
tests/captureCoordinator.test.ts
tests/ipcRegistrationSecurity.test.ts
tests/privateHubLifecycle.test.ts
tests/privateHubs.test.ts
tests/uiDevModernStyles.test.ts
```

Untracked source/tests that are part of the intended fix:

```text
src/main/services/replayMp4OverlayRasterizer.ts
src/shared/atlasCaptureLifecycle.ts
src/shared/atlasKnownOpponentHand.ts
tests/atlasCaptureLifecycle.test.ts
tests/atlasEmptyShellRecoveryIntegration.test.ts
tests/atlasKnownOpponentHand.test.ts
tests/atlasKnownOpponentHandIntegration.test.ts
tests/replayMp4OverlayRasterizer.test.ts
```

This handover and the `CURRENT_STATE.md` update will also appear as documentation changes after creation.

## Validation Of The Combined Desktop Worktree

Completed on 2026-07-28 after all five local changes:

- `npm run lint` - passed;
- focused Atlas recovery/lifecycle, known-hand, IPC/shortcut/UI integration, and replay MP4 overlay tests - passed;
- Windows/Electron overlay probe - exact-size transparent PNG rendered successfully;
- Atlas raw-capture audit - 105 raw documents parsed, 10 files with qualifying reveals, 0 spectator-derived remembered cards;
- `npm test` - 97 files / 836 tests passed;
- `npm run build` - Electron TypeScript, game preload bundle, and Vite production build passed;
- `npm run electron:smoke` - passed (`RiftLite development smoke passed`);
- Windows NSIS packaging - passed;
- `npm run release:verify:win` - installer metadata, NSIS archive, packaged ASAR/resources, blockmap, updater manifest, and FFmpeg verification passed;
- `npm run release:smoke:packaged` - passed (`RiftLite packaged smoke passed`);
- `git diff --check` - passed.

The normal Vite warning about the large renderer chunk remains non-blocking.

Not completed after these fixes:

- no live Atlas match reveal/UI interaction after adding the known-hand panel;
- no macOS build;
- no GitHub commit/push/tag/release;
- no website/Vercel deployment;
- no Discord action;
- no production-data mutation.

## Separate Website Worktree - Preserve It

The canonical website worktree is also intentionally dirty.

Branch/HEAD:

- branch: `codex/riftreplay-preview-20260703`
- HEAD: `c6bda27` (`Fix Discord replay result recovery`)

It contains the local-only Web Replay analysis/take-control work discussed with the user, including drag/drop, right-click controls, chain manipulation, target arrows, inferred known opponent cards, and related TCGA/player/model work. It has not been deployed as part of this handover.

Current website changes include:

```text
next-env.d.ts
src/app/api/v2/replays/[replayId]/route.ts
src/components/replay-v2/ReplayV2Player.module.css
src/components/replay-v2/ReplayV2Player.test.ts
src/components/replay-v2/ReplayV2Player.tsx
src/components/replay-v2/model.test.ts
src/components/replay-v2/model.ts
src/lib/replay-v2/tcga/normalize-tcga-replay.test.ts
src/lib/replay-v2/tcga/normalize-tcga-replay.ts
src/lib/social/hub-permissions.test.ts
src/components/replay-v2/analysis-mode.ts (new)
src/components/replay-v2/analysis-mode.test.ts (new)
tsconfig.tsbuildinfo
```

`next-env.d.ts` and `tsconfig.tsbuildinfo` are generated noise unless a deliberate framework change proves otherwise. Do not broadly stage them. The website diff is large (roughly 2,600 added lines) and must not be overwritten by a desktop-only task.

No website validation was rerun during the final Atlas empty-shell fix. Use the website's own test/lint/build gates before continuing or deploying it.

## Recommended Next-chat Sequence

1. Read this file and the top of `docs/CURRENT_STATE.md`.
2. Run `git status --short --branch` in both canonical repositories.
3. Inspect the five desktop changes independently.
4. Decide with the user whether the next action is:
   - real local manual testing;
   - additional fixes;
   - or preparing a new Windows/macOS release.
5. Before a release, manually test:
   - Atlas healthy startup;
   - a deliberately broken/empty Atlas shell if reproducible;
   - **Repair now** and **Show Atlas now**;
   - Atlas BO1 and BO3 room transitions;
   - no ghost `Unknown` match after a completed BO3;
   - replay MP4 export with a timed flag/note and a drawing visibly burned in;
   - Atlas reveal effect, top-bar eye badge, real card art, per-card dismissal, automatic exact-card departure/return, concealment retention, `F12`, and other-hotkey conflict;
   - owner removes a member and a co-owner;
   - co-owner removes a member but cannot remove owner/co-owner;
   - member sees no removal control;
   - TCGA capture remains unchanged.
6. If publishing, use a new version rather than replacing v0.9.12, run the full release gate and Windows artifact verification, then produce matching native macOS x64/arm64 artifacts through the Mac workflow.

## Suggested Opening Prompt For The New Chat

```text
Please read:
C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06\docs\HANDOVER_2026-07-27_POST_V0.9.12.md
C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06\docs\CURRENT_STATE.md

Continue from the existing dirty worktrees. Do not reset or discard anything. First inspect git status in both the desktop and website repositories, then summarize the five post-v0.9.12 desktop changes and wait for my next instruction.
```
