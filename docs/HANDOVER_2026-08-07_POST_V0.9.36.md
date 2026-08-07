# RiftLite Post-v0.9.36 Handover - 2026-08-07

> This is the authoritative starting point for a new Codex chat after the v0.9.36 release. It supersedes older handovers for current release, branch, and working-tree state. Use `docs/CURRENT_STATE.md` as the longer architecture and historical record, not as the sole freshness source.

## Executive Summary

- RiftLite v0.9.36 is live and marked latest for both Windows and macOS.
- The runtime release source is commit `9aa990df1115dae62bbb1083d8962326848afafc`.
- Annotated tags `v0.9.36` and `mac-v0.9.36` both peel to that release source commit.
- Both repositories' `main` and `agent/release-v0.9.12` branches are at the later publication-documentation commit `ad5dc1a67ce82cb61d0cc116afe230d250bf762d`.
- The historical branch name does not indicate an old binary: `package.json` and the published application are version `0.9.36`.
- v0.9.36 improves Atlas empty-shell recovery and connection diagnostics, repairs Match Review save/delete failures caused by poisoned sql.js runtimes or missing/corrupt local rows, and adds a non-destructive **Clear from activity** action for completed Web Replay warnings.
- The Windows release passed 111 test files / 1,005 tests plus packaging, updater, NSIS, and packaged smoke checks. The native Mac workflow passed the same source gate plus Intel/Apple Silicon packaging and Mac-specific verification.
- All three Windows and all five macOS public assets were independently downloaded and verified against their public sizes, SHA-256 digests, and updater-manifest SHA-512 entries.
- No website deployment, Discord action, or production-data mutation was required for v0.9.36.
- Before this handover was created, the canonical desktop checkout was clean. The expected local changes after handover creation are documentation only; do not discard them.

## Canonical Locations

### Desktop release source

`C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06`

This is the only desktop checkout to use for current production work and future releases.

### Website checkout commonly opened in this workspace

`C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\RiftLite-website`

This checkout is on a historical replay-preview branch and is not a clean representation of current live `main`. Preserve it; see **Website State** below.

### Clean production-equivalent website worktree

`C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\RiftLite\.codex-worktrees\web-v0931`

This worktree is at website commit `4d86629` and matches `origin/main` as of this handover. For new website work, prefer a fresh branch/worktree from current `origin/main` rather than coding on the historical replay-preview checkout.

### Checkouts not to use as current release source

- the old application/source root at `C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\RiftLite` (the specifically named registered website worktree under its `.codex-worktrees` directory is the exception)
- `C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-ui-dev`
- copied or older Mac source trees

`desktop-ui-dev` is a heavily dirty legacy/UI-development worktree with many tracked and untracked changes. Never reset, clean, overwrite, or release from it.

## Desktop Git Truth

| Item | Exact state |
| --- | --- |
| Local branch | `agent/release-v0.9.12` |
| Current branch/documentation HEAD | `ad5dc1a67ce82cb61d0cc116afe230d250bf762d` (`Document v0.9.36 publication`) |
| Runtime release source | `9aa990df1115dae62bbb1083d8962326848afafc` (`Release RiftLite v0.9.36`) |
| Windows tag | annotated `v0.9.36`, peels to `9aa990d` |
| macOS tag | annotated `mac-v0.9.36`, peels to `9aa990d` |
| Windows remote | `windows` -> `cdfpartridge-web/RiftLite-Desktop` |
| macOS remote | `origin` -> `cdfpartridge-web/RiftLite-Desktop-mac` |
| Remote Windows branches | `main` and `agent/release-v0.9.12` at `ad5dc1a` |
| Remote macOS branches | `main` and `agent/release-v0.9.12` at `ad5dc1a` |
| Package/build version | `0.9.36` |

Important distinctions:

- The tags deliberately remain on the runtime release commit, not the later documentation commit.
- Do not move, overwrite, or recreate either v0.9.36 tag.
- Local branch `main` is stale and should not be used as a source baseline. Stay on the current release branch or create a fresh branch from a verified remote `main`.
- A future public release must use a new version such as `0.9.37`; never replace v0.9.36 assets or tags.

## Expected Local Worktree After This Handover

The handover is intentionally local and has not been committed or pushed. The expected desktop status is documentation-only:

```text
 M docs/CURRENT_STATE.md
 M docs/HANDOVER_2026-07-27_POST_V0.9.12.md
 M docs/WEB_REPLAY_SYSTEM_HANDOVER.md
?? docs/HANDOVER_2026-08-07_POST_V0.9.36.md
```

There are no uncommitted source, test, package, or release-build changes in the canonical desktop checkout. Preserve these documentation changes when starting the new chat.

## Live Release Matrix

| Platform | Public release | State |
| --- | --- | --- |
| Windows | `https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.9.36` | public, latest, non-draft, non-prerelease |
| macOS | `https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.9.36` | public, latest, non-draft, non-prerelease |
| Native Mac workflow | `https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/31171550063` | successful at release source `9aa990d` |

Both public updater feeds resolve to version `0.9.36`:

- Windows: `https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/latest/download/latest.yml`
- macOS: `https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/latest/download/latest-mac.yml`

Historical Mac tags `mac-v0.9.34` and `mac-v0.9.35` exist but have no published installer releases. GitHub Actions cancelled those jobs before assigning a runner during an outage. They were superseded by the fully verified v0.9.36 Mac release; do not move or backfill those immutable tags.

## Verified Public Artifacts

### Windows

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `RiftLiteBetaInstall.exe` | 216,037,882 | `617B7475E1A63E27FFB852D2FF334D3952185DD55EA8586BAC8CFE7BB8184CD4` |
| `RiftLiteBetaInstall.exe.blockmap` | 203,434 | `500E095AA879794A12C008BC786269C21A7D0E7B4F81278050C02146C546E647` |
| `latest.yml` | 344 | `ACB2ED7F62DD9BC7B9A770E3CDAA85151114318180E4BB9F6BC3657E2D621F7A` |

The canonical local Windows installer matches the public file exactly:

`C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06\release\RiftLiteBetaInstall.exe`

Do not infer that other Mac-named files under local `release\` are current. In particular, the local `release\latest-mac.yml` is stale v0.9.0 material; the verified v0.9.36 Mac artifacts are the public release assets listed below.

### macOS

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `RiftLiteBetaInstall-arm64.dmg` | 172,799,229 | `F91226B9461ED2DD40BEBB7120BBC493A8340D4D51D299DB06189F1CAD66CA85` |
| `RiftLiteBetaInstall-arm64.zip` | 165,421,578 | `B7471E03C269D6EC98C5E8EADACB605F553E16283D58979F86A637A65326A6B0` |
| `RiftLiteBetaInstall-x64.dmg` | 187,984,957 | `DF942F7A5E3FB880C0F069CDA75BF39BC12944AB51FA84EE16595624397B07B3` |
| `RiftLiteBetaInstall-x64.zip` | 180,321,914 | `E06FD533DB85D40373831C8B76F6A93FCC520514D84F2754E25BC4A0CC24FA38` |
| `latest-mac.yml` | 830 | `A6FB6599642DE26F49912DE21F02FEB76DFAD2ECF0005B703A746ECBC818DBF7` |

The Mac workflow verified the x64 and arm64 executables and FFmpeg binaries, bundle identity and updater configuration, strict ad-hoc signatures, both DMGs, packaged startup, artifact upload, and release attachment.

## What v0.9.36 Changed

### 1. RiftAtlas empty-shell and startup recovery

User symptom:

- RiftLite could remain on **Starting RiftAtlas** while Atlas returned only an empty/static outer shell.
- Some networks or security gateways returned an HTTP 200 placeholder page where Atlas advertised a JavaScript application chunk.

Current behavior:

- Shell health and recovery decisions are bound to the current guest navigation, so stale shell-ready events cannot reset the wrong recovery attempt.
- The automatic runtime repair is limited to one attempt and preserves Atlas cookies, local storage, IndexedDB, Atlas-local decks, and all RiftLite data.
- Recovery clears only disposable runtime state: code cache, HTTP cache, service workers, Cache Storage, and open network connections.
- The normal startup cover fails open after 28 seconds; the post-repair cover uses a shorter 12-second limit so Atlas cannot remain hidden indefinitely.
- If runtime repair still returns an empty shell, RiftLite reveals the page and offers **Reset Atlas sign-in**. This removes Atlas authentication cookies while preserving local storage, IndexedDB, Atlas-local decks, and RiftLite data.
- The stronger full-site reset remains a separate explicit settings action and can clear Atlas-local site data. Do not invoke it casually.
- Connection diagnostics now probe the final advertised Atlas application script, require a JavaScript MIME type and meaningful body, and reject HTML/placeholder responses even when the HTTP status is 200.

Primary files:

- `src/main/services/atlasConnectionDiagnostics.ts`
- `src/main/services/atlasEmptyShellMainRecovery.ts`
- `src/shared/atlasShellHealth.ts`
- `src/shared/atlasWebviewRecovery.ts`
- `src/renderer/atlasShellVisibility.ts`
- `src/game-preload/gamePreload.ts`
- `src/main/main.ts`
- `src/renderer/App.tsx`

Primary tests:

- `tests/atlasConnectionDiagnostics.test.ts`
- `tests/atlasEmptyShellMainRecovery.test.ts`
- `tests/atlasEmptyShellRecoveryIntegration.test.ts`
- `tests/atlasShellHealth.test.ts`
- `tests/atlasShellVisibility.test.ts`
- `tests/atlasWebviewRecovery.test.ts`

### 2. Match Review save and Delete capture reliability

User symptoms:

- Save or Delete capture could start failing after several games.
- The review could report that deletion failed even though the durable delete had already completed and only the follow-up history refresh failed.
- A review created after the first local write failed could not be deleted because no stored row existed yet.

Root cause and repairs:

- A poisoned sql.js WebAssembly runtime can report more than `memory access out of bounds`; observed variants include `table index is out of bounds` and `null function or function signature mismatch`. RiftLite now reopens the last durable SQLite file and retries the mutation once for the broader runtime-failure family.
- Delete capture passes the open in-memory review as a validated fallback. It can create a recycle-bin tombstone even when the initial row never committed, and can replace an unreadable match row.
- An unreadable linked replay metadata row is skipped rather than permanently blocking deletion of its parent capture.
- The durable database deletion is the completion point. Later Match History refreshes use `Promise.allSettled`, so a refresh failure cannot misreport a committed delete as failed.
- The capture coordinator fences discarded review IDs for the rest of the process, preventing an already-running replay finalizer from recreating deferred work after deletion.

Primary files:

- `src/main/services/store.ts`
- `src/main/services/captureCoordinator.ts`
- `src/main/main.ts`
- `src/preload/appPreload.ts`
- `src/renderer/App.tsx`
- `src/shared/types.ts`

Primary tests:

- `tests/storeRecovery.test.ts`
- `tests/reviewDraftPersistence.test.ts`
- `tests/reviewLifecycleIntegration.test.ts`
- `tests/captureCoordinator.test.ts`

### 3. Completed Web Replay warning dismissal

User symptom:

- A replay marked **Ready** with a warning such as `The replay did not capture the opening mulligan` remained in **Upload activity** forever and had no removal action.

Why it happened:

- The replay was already successfully online, so **Keep local only** correctly refused to remove it through the local upload queue.
- The UI intentionally retained ready items with partial warnings but had no separate acknowledgement action.

Current behavior:

- Ready warning cards now show **Clear from activity**.
- Clearing the card does not delete or modify the local match, raw capture, local replay, warning metadata, upload URL, or online replay.
- The acknowledgement is stored only in renderer `localStorage`, keyed by platform, capture session, and normalized warning signature.
- It retains at most 200 acknowledgement keys. A changed warning signature appears again.
- The card can reappear on another device/profile or after renderer storage is reset. That is expected because this is presentation state, not server state.
- There is still no online Web Replay deletion API/UI in this flow. Treat remote deletion as separate future work.

Primary files:

- `src/shared/webReplayActivity.ts`
- `src/renderer/App.tsx`
- `tests/webReplayActivity.test.ts`
- `tests/webReplayAccountDiagnosticsIntegration.test.ts`

## Validation Completed

Windows release command:

`npm run electron:build`

That canonical command passed:

- TypeScript lint/typecheck;
- the 79-test account-sync release gate;
- all 111 test files / 1,005 tests;
- Electron main build;
- game-preload bundle;
- Vite production renderer build;
- Windows x64 packaging and NSIS creation;
- updater-manifest and blockmap verification;
- executable metadata, packaged ASAR/resources, FFmpeg, and NSIS archive integrity checks;
- isolated packaged-app smoke testing.

The normal Vite large-renderer-chunk warning remains non-blocking.

The native Mac workflow ran from the immutable `mac-v0.9.36` tag and passed:

- the same source release gate;
- both x64 and arm64 packaging;
- architecture-specific FFmpeg preparation and license checks;
- updater and bundle identity validation;
- executable and FFmpeg architecture checks;
- strict ad-hoc signature checks;
- DMG verification;
- packaged-app smoke testing;
- public asset upload and release attachment.

No post-release real Atlas or TCGA gameplay smoke was recorded during the publication procedure. Automated coverage is strong, but confirmation from affected testers remains valuable.

## Hard Continuity Rules

Preserve these identities and paths:

- app ID: `com.riftlite.desktop.beta06`
- installed product/executable name: `RiftLite Beta 0.9`
- user-data directory: `%APPDATA%\RiftLite Beta 0.6`
- media directory name: `RiftLite`
- deep-link protocol: `riftlite://`
- Windows updater repository: `cdfpartridge-web/RiftLite-Desktop`
- macOS updater repository: `cdfpartridge-web/RiftLite-Desktop-mac` (the package configuration uses the case-equivalent `RiftLite-Desktop-Mac` spelling)
- Windows installer name: `RiftLiteBetaInstall.exe`
- Mac artifact pattern: `RiftLiteBetaInstall-${arch}.{dmg,zip}`
- production defaults: automatic updates and usage analytics enabled

Preserve existing:

- account identity aliases and secure credentials;
- local matches, deleted-match tombstones, decks, replay associations, recordings, raw captures, and upload manifests;
- private hub ownership/membership and Discord sharing settings;
- Atlas and TCGA provider boundaries and privacy checks.

Before changing anything:

1. Run `git status --short --branch` in every repository or worktree in scope.
2. Read current diffs before editing; do not assume a historical handover describes the current tree.
3. Never use broad reset, checkout, clean, formatting, or staging commands on a dirty worktree.
4. Keep Atlas and TCGA capture changes provider-gated unless a shared behavior is deliberate and tested.
5. Treat raw WebSocket events, replay captures, account tokens, Discord tokens, and production data as security-sensitive.
6. Do not rebuild installers, deploy, push, tag, publish, send Discord messages, or mutate production data without explicit user approval.
7. Keep Vision Deck Tracker and the old reconstructed Replay Lab hidden unless the user explicitly reopens that product work.

## Website State

No website source or deployment was required for v0.9.36.

The commonly opened website checkout currently has:

| Item | State |
| --- | --- |
| Path | `C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\RiftLite-website` |
| Branch | `codex/riftreplay-preview-20260703` |
| HEAD | `5099cfa` (`Allow anonymous account adoption`) |
| Tracking state | ahead 5 of its historical upstream; also diverged from current `origin/main` |
| Current `origin/main` | `4d86629` (`Allow anonymous account adoption`) |
| Dirty entries | `next-env.d.ts` metadata/stat entry and generated `tsconfig.tsbuildinfo` change |

Preserve that checkout. Do not reset the generated entries and do not use it as a release baseline. For website work, fetch first and create a clean branch/worktree from current `origin/main`, or use the clean production-equivalent worktree identified above after re-verifying it.

Website deployment rules are separate from desktop release rules. A desktop change does not imply a Vercel deployment, and a website-only replay-player change often requires no desktop installer.

## Known Limitations And Parked Work

- Windows installers are not Authenticode-signed. macOS artifacts are ad-hoc signed rather than notarized. OS trust prompts may still occur.
- Atlas automatic empty-shell recovery runs once, then exposes recovery choices. It deliberately does not loop forever.
- **Clear from activity** is device/profile-local and is not an online replay deletion mechanism.
- There is no Web Replay artifact garbage collector or general online replay deletion/retention UI.
- TCGA authoritative Web Replay remains BO1-only; multi-game/BO3 capture is rejected rather than guessed. Replay combining remains Atlas-only.
- Web Replay upload/playback needs internet and has no complete offline canonical cache. The compressed upload limit remains 4 MiB; captures classified as too large are not automatically retried.
- The signed-in owner replay library currently loads the API default of 48 records and has no pagination. The API permits an explicit maximum of 100, but the owner UI does not request or page through it. The public archive itself does paginate.
- Atlas known-opponent-hand tracking can retain too many possibilities after an anonymous hidden departure. The UI deliberately reports uncertainty rather than inventing an identity.
- Historical incomplete Kennen-Yasuo rows and the ambiguous Darius-Lillia replay association were deliberately left untouched. Repair them only as a separate, backed-up data operation.
- Older sections of `CURRENT_STATE.md` and `WEB_REPLAY_SYSTEM_HANDOVER.md` are append-only history and contain stale statements. The new handover, current code, current production branches, and focused tests take precedence for present state.

## Local Cleanup Note

Independent verification downloads were left outside the repository in Windows Temp after verification:

| Temp directory | Bytes |
| --- | ---: |
| `C:\Users\cdfpa\AppData\Local\Temp\riftlite-v0936-mac-6cf55cd7ab6641d1a311ee39c621578b` | 706,528,508 |
| `C:\Users\cdfpa\AppData\Local\Temp\riftlite-v0936-win-3c2fc506bd3341408ca68eb3887abf2b` | 216,241,660 |
| `C:\Users\cdfpa\AppData\Local\Temp\riftlite-v0936-win-bc10058f6fef4f118bbad32ae8d02f38` | 216,241,660 |

Total: 1,139,011,828 bytes. These are downloaded copies of already-verified public release assets, not application data, and are safe to remove when convenient. Do not confuse them with the canonical local Windows artifact under `desktop-v06\release`.

## Documentation Routing

Read only what is relevant to the next task:

- Current starting point: `docs/HANDOVER_2026-08-07_POST_V0.9.36.md`
- Long release/product history: `docs/CURRENT_STATE.md`
- Customer-facing v0.9.36 notes: `docs/release-notes-v0.9.36.md`
- Replay V2 architecture, privacy, upload, and player reference: `docs/WEB_REPLAY_SYSTEM_HANDOVER.md` (its release-status header is historical; use this handover and current code for present status)
- Account linking/onboarding: `docs/account-onboarding.md`
- Account cloud sync: `docs/account-cloud-sync.md`
- Historical post-v0.9.12 implementation detail: `docs/HANDOVER_2026-07-27_POST_V0.9.12.md`

The older handovers remain useful implementation history but are not current release or working-tree authority.

Two especially stale statements in older `WEB_REPLAY_SYSTEM_HANDOVER.md` sections must not be carried forward: TCGA Web Replay has now been published but remains BO1-only, and the public replay archive now paginates. The signed-in owner library is the replay listing that remains unpaginated.

## Recommended First Sequence In A New Chat

1. Read this handover first, then the top/current-release section of `docs/CURRENT_STATE.md`.
2. Run `git status --short --branch` in the canonical desktop repo.
3. If website work is in scope, inspect both the historical website checkout and a clean worktree from current `origin/main` before editing.
4. Summarize the v0.9.36 baseline and any existing local documentation changes.
5. Wait for the user's next bug or feature request; do not infer a deployment or new release.
6. Reproduce and diagnose before changing capture, account, replay, or production behavior.
7. Run focused tests first, then `npm run lint` and `npm test` for meaningful desktop changes.
8. If a new release is explicitly requested, bump beyond `0.9.36`, rebuild and verify Windows locally, publish a new immutable Windows tag/release, and trigger the matching native Mac tag workflow.

## Copy-ready Opening Prompt For The New Chat

```text
Please read these first:
C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06\docs\HANDOVER_2026-08-07_POST_V0.9.36.md
C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06\docs\CURRENT_STATE.md

Work from the canonical desktop repository:
C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06

RiftLite v0.9.36 is live for Windows and macOS. Before changing anything, inspect git status in every repository/worktree in scope and preserve all existing changes. The desktop release branch name is historical but its source is current; do not switch to the stale local main branch. The commonly opened website checkout is historical and diverged from live main, so website work must start from a verified clean current origin/main worktree.

Do not reset, clean, rebuild, deploy, push, tag, publish, send Discord messages, or mutate production data unless I explicitly ask. For replay/privacy work also read docs/WEB_REPLAY_SYSTEM_HANDOVER.md as an architecture/privacy reference, but take current release status from the new handover and code. For account work read docs/account-onboarding.md and docs/account-cloud-sync.md. Summarize the current baseline, then wait for my next instruction.
```
