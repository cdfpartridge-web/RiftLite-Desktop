# RiftLite Current Engineering State

Last updated: 2026-07-12

This is the durable handoff for continuing RiftLite work in a fresh Codex task. Read this file before changing code.

## Canonical Repository

- Active cross-platform release source repo:
  `C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06`
- Current package version: `0.8.0` (customer-facing release `v0.8.00`)
- Current branch: `main`
- Windows GitHub release repository (`windows` remote): `cdfpartridge-web/RiftLite-Desktop`
- macOS GitHub release repository (`origin` remote): `cdfpartridge-web/RiftLite-Desktop-mac`
- Current published Windows release: `v0.8.00` (2026-07-12)
- Current published macOS release: `mac-v0.8.00` (2026-07-12)
- Windows installer output:
  `C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06\release\RiftLiteBetaInstall.exe`

Always name the remote explicitly when pushing: Windows source/tags go to `windows`; macOS source/tags go to `origin`. The repositories and release tags are deliberately separate.

Do not accidentally work from:

- `C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\RiftLite`
- the separate `0.8.0` experiment/side project
- an old copied Mac source tree unless the task explicitly concerns the Mac build

The active working tree is intentionally dirty and contains a large amount of current work. Never reset, discard, or overwrite unrelated changes.

## Immediate Working Rules

1. Read `git status` and the relevant code before editing.
2. Preserve existing user changes and unrelated dirty files.
3. Keep TCGA and Atlas capture fixes platform-gated wherever possible.
4. Run focused tests first, then `npm test` and `npm run lint` for meaningful changes.
5. Do not rebuild installers, publish releases, or deploy the website unless explicitly requested.
6. Treat raw WebSocket replay data, account sync, hub ownership, Discord tokens, and API keys as security-sensitive.
7. RiftReplay/Replay Lab and Vision work are parked or hidden. Do not expose them in menus or release notes unless explicitly requested.

## Current Product Shape

RiftLite is an Electron desktop companion for Riftbound play on TCGA and RiftAtlas. It combines:

- automatic match capture and BO1/BO3 review
- local match history and analytics
- full-video replay capture, review, coaching annotations, clips, and MP4 export
- saved decks, testing notebooks, matchup prep, mulligan/sideboard/battlefield guides
- community meta, match matrix, community decks, and Matchup Lab
- private hubs, public teams, LFG listings, and Discord integrations
- linked player accounts and opt-in account cloud sync
- Scorepad and local/IRL match logging
- home/dashboard content, featured creators, streams, videos, and partners

## Architecture Map

### Electron Main Process

- `src/main/main.ts`
  - application startup and BrowserWindow lifecycle
  - IPC registration
  - game-view integration
  - replay and capture orchestration
  - updater and external service wiring
- `src/main/services/captureCoordinator.ts`
  - receives platform capture evidence
  - coordinates draft/review readiness
  - dispatches renderer-facing match review events
- `src/main/services/matchSessionTracker.ts`
  - core BO1/BO3 state and game-row construction
  - Atlas and TCGA session continuity, dedupe, score, battlefield, and result logic
- `src/main/services/store.ts`
  - sql.js local database
  - migrations, import/export, backups, recovery, match/deck/replay persistence
- `src/main/services/firebaseSync.ts`
  - account/profile/community/hub/team sync
  - opt-in account cloud backup and restore
- `src/main/services/rawCaptureService.ts`
  - Atlas raw WebSocket sidecar capture and optional replay upload
- `src/main/services/deckTrackerService.ts`
  - active deck and Atlas event-driven deck/opponent tracking
- `src/main/services/tcgaResolver.ts`
  - TCGA card/legend resolution and lookup fallback
- `src/main/services/updaterService.ts`
  - GitHub update metadata and application update flow

### Game Preload

- `src/game-preload/gamePreload.ts`
  - observes embedded TCGA/RiftAtlas game state
  - extracts DOM and WebSocket evidence
  - forwards capture, raw replay, and deck-tracker events to Electron

This code runs close to the game page. Avoid expensive synchronous work, broad polling, or duplicate frame/event ingestion.

### Renderer

- `src/renderer/App.tsx`
  - current monolithic application shell and most feature pages
  - over 22,000 lines; edit carefully and avoid broad formatting churn
- `src/renderer/styles/app.css`
  - global desktop UI styles
- `src/renderer/RiftLiteReplayViewer.tsx`
  - parked/hidden reconstructed raw replay viewer

### Shared Logic

- `src/shared/types.ts`: cross-process data contracts
- `src/shared/legendNames.ts`: canonical legend normalization
- `src/shared/legendImages.ts`: legend/card art recognition mappings
- `src/shared/deckNotebook.ts`: local notebook/prep normalization and package shapes
- `src/shared/deckTracker.ts`: tracker types and calculations
- `src/shared/atlasEventDeckTracker.ts`: Atlas event-driven card tracking
- `src/shared/riftLiteReplayEngine.ts`: parked raw replay reconstruction engine

### Preload API

- `src/preload/appPreload.ts`
  - typed renderer-to-main API surface
  - keep IPC names and shared types synchronized with `main.ts` and renderer usage

## Match Capture State

### Required Behaviour

- BO1: show one review after a clearly completed game.
- BO3: maintain one parent session with child game rows.
- Never show the review during Atlas sideboarding or between games.
- At a 1-1 score, wait for game 3.
- At a genuine 2-0 or 2-1 match end, show one review containing all games.
- Saving a review must retire its pending draft and must not produce a second popup.
- Replay evidence must remain attached to the correct match/session.

### Sensitive Areas

- Atlas transitions can contain confirm-winner, sideboard, blank/0-0, setup, and lobby evidence.
- Opponent identity has historically been one of the strongest session-continuity signals.
- Capture events can arrive as delayed echoes; game rows require stable identity/dedupe.
- Do not infer a winner solely from who is ahead when someone concedes.
- TCGA low-score resets can mark game boundaries in BO3; keep Atlas-specific fixes from changing TCGA logic.

### Recent Legend Detection Work

- Vendetta Preview support and canonical legend mappings were added for both platforms.
- Akali detection was fixed on TCGA and Atlas.
- TCGA Kennen opponent detection was most recently fixed using exact Riot image hash:
  `0eab83392b310417d2630d50a3bfee3dd02b31c4`
- Related files:
  - `src/shared/legendImages.ts`
  - `src/main/services/tcgaResolver.ts`
  - `resources/tcga_card_lookup.json`
  - `tests/tcgaResolver.test.ts`
  - `tests/legendNames.test.ts`
  - `tests/matchSessionTracker.test.ts`

## Replay And Recording State

User-facing replay features include:

- continuous full-video capture
- replay library search/filtering and health states
- flags, drawings, audio notes, presentation recording, and coaching packs
- MP4 export, including WebM/VP8 transcoding when stream copy is invalid
- clip export with custom lengths, crop/vertical options, and RiftLite watermark
- fullscreen timeline, +/-20-second controls, and 2x/4x/6x playback
- original-audio volume and mute controls
- Shadowplay-style rolling clips and a live review-flag hotkey

Raw Atlas/WebSocket replay reconstruction is now enabled as the first-party **RiftLite web replay** feature. It is Atlas-only and requires an explicit, account-bound Settings opt-in before capture and automatic upload begin. The old local reconstructed Replay Lab remains parked.

Vision deck tracking was also paused. Keep its source and types, but do not start workers, sample frames, or show Vision UI while its feature flag is disabled.

## Decks, Prep, And Matchup Tools

- Deck names are editable.
- Deck Notebook is local-first and keyed by deck ID.
- It includes goals, version snapshots, watchlist, linked match notes, and version performance.
- Matchup Prep supports default and per-legend guides:
  - mulligan Keep/Consider/Avoid
  - visual sideboard In/Out
  - battlefield categories
  - notes and card priority groups
- Prep supports package/text/PDF import and export.
- Prep is manually opened during play; it should not auto-pop at game start.
- Prep and tracker widgets should be movable/resizable and should not steal focus from game chat.
- Matchup Lab includes visual matchup results, replay evidence, prep shortcuts, community context, and deck comparison.
- Community Decks groups unique decklists for inclusion percentages and uses matches for performance stats.

## Community And Seasons

- Community detail data is served from cached/chunked website aggregates rather than raw Firestore scans.
- The detailed public window was expanded beyond the original 2,000/5,000 cap; verify the current website cache manifest before changing limits.
- Range views are intended to use precomputed 7/14/30-day aggregates.
- Private hub matches contribute only cached headline counts, never public deck/match details.
- Vendetta Preview is the current season layer.
- Pre-Vendetta meta is archived but should remain filterable.
- New season framework should preserve old data and allow a clean official Vendetta launch boundary.

## Social, Hubs, Teams, And Discord

- LFG listings support TCGA/RiftAtlas room code, BO1/BO3, legend preferences, notes, expiry, accept/close flow, and optional Discord voice.
- Public teams are separate from private hubs.
- Team and hub match sync should not open the normal match review popup.
- Non-members must not see sync/moderation controls.
- Hub ownership and invite actions are permission-sensitive; never rely on a client-readable password hash as proof of ownership.
- Discord work includes LFG voice rooms and groundwork for a testing-group bot:
  - account/hub verification and role assignment
  - recent match feed
  - testing leaderboards
  - goals/progress
  - contribution badges
  - announcements and weekly reports
- Bot tokens must remain server-side and must never be placed in desktop code, diagnostics, Firestore-readable documents, or committed files.

## Account Cloud Sync

Account sync is opt-in and is intended to move local structured data to another device without syncing replay video media.

Firestore path:

- `accountSync/{uid}/manifest/current`
- `accountSync/{uid}/chunks/chunk-0000...`

Rule requirement:

```txt
match /accountSync/{uid}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

See:

- `docs/account-cloud-sync.md`
- `docs/firestore-account-sync.rules`

The July 9 account-sync hardening is implemented in the current dirty working tree; see the resolved review findings below and keep their regression coverage intact.

## Account Onboarding Redesign (Local, Not Yet Published)

- Anonymous Firebase refresh tokens are no longer presented as linked RiftLite accounts.
- Desktop account UI now has explicit local, linking, needs-profile, ready, and reconnect states.
- All website account entry points share one Google/email onboarding flow with required display-name and handle completion.
- Desktop linking, private-hub invites, Discord verification, Find Match, and team tools automatically resume after profile completion.
- Website now has `/account` and `/hubs` destinations, and the desktop supports `riftlite://hubs/{hubId}` navigation.
- Linking an existing provider account to a different desktop UID creates an additive identity association and migrates memberships, ownership, replay indexes, identity snapshots, inbox, Discord links, and cloud backup without deleting source records.
- Existing canonical cloud backup data is never overwritten during identity association; conflicts are retained for explicit recovery.
- Current profile identity is resolved for hub member lists and Discord reports, while new community writes take canonical server profile identity.
- The legacy name/password private-hub flow remains available.
- See `docs/account-onboarding.md` for invariants and migration rules.

## Parked Or Hidden Features

Do not delete these, but keep them out of normal navigation and release notes unless requested:

- Vision Deck Tracker
- local reconstructed Replay Lab / RiftLite raw replay viewer

The external RiftReplay upload integration remains separate from first-party RiftLite Web Replay consent. Legacy hidden settings migrate off, first-party consent is bound to the linked account UID, unlinking revokes it, and visibility defaults to private.

## RiftLite Web Replay

- Settings exposes **Automatically upload Atlas replays** only for a linked RiftLite account.
- Completed Atlas captures upload through the authenticated Replay V2 init/raw/complete protocol and are owned by that Firebase account.
- Continuous BO3 captures carry a privacy-safe result summary (`format`, perspective-relative series/game results, and points only) inside the immutable raw artifact. Names, account/player IDs, battlefield labels, notes, chat, decks, and raw match evidence are excluded. The website restores missing canonical per-game winners/scores from this summary without replacing raw-derived results.
- The web player presents data-driven between-game scenes, including exact perspective-player sideboard cards Out/In from the confirmed `submit_sideboard` action, quantities, first-player choice without fake dice when no initiative roll occurred, BO3 game/series score, and a privacy-safe generic opponent lock state.
- If the match-end DOM evidence omits the Atlas room code, raw capture finalization may use the sole session inside the existing strict match-time window even when that session learned a room identity from WebSocket traffic. Ambiguous and stale candidates remain rejected.
- The website `/replays` page exposes public and signed-in owner libraries.
- The desktop **RiftLite web replay** tab embeds `/replays/embed?embed=1` in an isolated Electron partition.
- The embedded owner library uses a short-lived Secure/HttpOnly cookie; raw uploads and mutations remain bearer-token-only.
- Replay account authorization uses verified durable Firebase identities, not only the current `sign_in_provider`. This is required because the desktop account starts anonymously and may retain that session label after Google/email are linked.
- If embedded owner authorization fails, the website falls back to the Public library and the desktop shows reconnect guidance plus an Account action instead of a blank-looking owner view.
- Account cloud backup and restore strip replay-upload consent so another device must opt in independently.

## Resolved Priority Code-Review Findings

These were found in the 2026-07-09 review and are fixed in the current dirty working tree.

### P1: Enabling Account Sync Can Overwrite A Good Remote Backup

- `src/main/services/firebaseSync.ts`, around `setAccountCloudSyncEnabled`
- Enabling sync immediately uploads local state.
- On a fresh second device, that can overwrite a useful remote backup before the user restores it.
- Required direction: inspect remote manifest first and offer Restore / Keep Local / Merge-or-Cancel. Never silently upload an empty/fresh local database over existing cloud data.
- Resolution: enabling now checks the remote manifest first, leaves sync disabled when a backup exists, and presents explicit Restore cloud / Keep local and replace cloud / cancel choices.

### P1: Account Backup Upload Is Not Atomic

- `src/main/services/firebaseSync.ts`, account backup chunk upload
- Fixed chunk IDs are overwritten before the manifest changes.
- A crash or concurrent device can produce a mixed-generation backup.
- Required direction: write immutable generation-scoped chunks, validate checksum/count, atomically switch the manifest pointer, then clean old generations.
- Resolution: v2 uploads use immutable generation IDs, per-chunk and full SHA-256 checksums, conditional Firestore manifest updates, and post-switch cleanup. Legacy v1 backups remain restorable and migrate on the next upload.

### P1: Hidden Raw Replay Capture May Still Upload Public Data

- `src/renderer/App.tsx`: Replay Lab visibility flag is off.
- `src/main/services/rawCaptureService.ts`: completion can still auto-upload.
- `src/main/services/store.ts`: existing/default raw visibility has been `public`.
- Users may have capture enabled but no visible control to disable it.
- Required direction: main-process feature gate, separate capture from upload, upload off by default, private default, and migrate existing settings safely.
- Resolution: the hidden feature is gated in the main process, capture/upload consent is separate, legacy consent migrates off, pending uploads use current privacy settings, and all defaults/fallbacks are private.

### P1: Atlas Dedupe Can Merge Legitimate BO3 Games

- `src/main/services/matchSessionTracker.ts`, `sameAtlasGameCapture`
- Two games with the same result/score can be considered duplicates when battlefield data is missing/compatible.
- Required direction: dedupe using explicit game number/result-event/session identity; do not use result+score+wildcard battlefield as the primary identity.
- Resolution: Atlas child games use tracker-session, ordinal, explicit game number, and result-event identity. Score/battlefield compatibility remains limited to short unconfirmed bridge echoes.

### P2: Atlas WebSocket Frames Can Be Ingested Twice

- preload path: `src/game-preload/gamePreload.ts`
- debugger path and preload IPC path: `src/main/main.ts`
- Both can feed raw capture/deck tracking.
- This can inflate sidecars, duplicate actions, and contribute to gameplay stickiness.
- Required direction: debugger is fallback-only, or all sources pass through one fingerprint deduper before services receive frames.
- Resolution: both sources pass through one cross-source fingerprint deduper; recent preload traffic suppresses the debugger path, which is retained only as fallback.

### P2: Raw Capture Uses One Global Active Session

- `src/main/services/rawCaptureService.ts`
- A room change can discard the prior capture, and delayed replay finalization can attach the wrong active sidecar.
- Required direction: key sessions by room/series/match identity and finish by explicit key.
- Resolution: raw captures are retained in a keyed session map and finalized by capture/series/match/replay/room identity, including explicit identity supplied by replay orchestration.

### P2: Cloud Restore Is Destructive Without A Transaction

- `src/main/services/store.ts`: restore deletes/repopulates tables.
- Manual restore creates a safety backup in `src/main/main.ts`; cloud restore does not.
- Required direction: always create a local safety backup, restore into a clone/transaction, validate, then atomically replace active state.
- Resolution: restore forces a local database snapshot, imports into an isolated sql.js clone, validates integrity, atomically writes it, and only then swaps the active database.

### Dependency Audit

`npm audit --omit=dev` reported four advisories at the last review, including a high Vite Windows advisory plus js-yaml/Babel/esbuild-related advisories. Review compatible dependency upgrades separately from feature work and retest packaging.

## Regression Coverage Added

Tests now cover:

- enabling account sync when a remote backup already exists
- interrupted/concurrent chunk upload generations
- cloud restore rollback after a mid-import failure
- dual debugger/preload WebSocket ingestion
- Atlas consecutive games with identical score/result and missing battlefield data
- raw capture privacy migration when the Replay Lab UI is hidden
- raw capture association across delayed match/replay finalization

## Last Verification Baseline

On 2026-07-10 after enabling RiftLite Web Replay:

- desktop `npm test` passed: 22 test files, 226 tests
- desktop `npm run lint` passed
- desktop `npm run build` passed
- desktop `npm run electron:build` produced the 0.7.90 installer, blockmap, and updater manifest
- packaged 0.7.90 startup smoke test reached `startup complete`
- website `npm test` passed: 22 test files, 132 tests
- website TypeScript, changed-file ESLint, and `npm run build` passed
- website production deployment: `dpl_DYBM1xX8s7L3bYMNQDMKoVM3e9y2`, aliased to `https://www.riftlite.com`
- GitHub release: `https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.7.90`
- `git diff --check` had no patch errors; only line-ending warnings

On 2026-07-10 after the initial local Replay V2 embed-auth repair:

- the actual linked desktop token was confirmed to contain signed Google/email identities while retaining `sign_in_provider: anonymous`
- Replay V2 now accepts that linked identity while still rejecting pure anonymous, bare custom, and malformed identity claims
- embedded owner-list 401 responses switch to Public replays with reconnect guidance; the desktop exposes an Account recovery action
- website `npm test` passed: 22 test files, 136 tests
- website TypeScript, changed-file ESLint, and `npm run build` passed
- desktop `npm test` passed: 22 test files, 226 tests
- desktop `npm run lint` and `npm run electron:build` passed
- a fresh local 0.7.90 installer, blockmap, updater manifest, and unpacked application were produced
- packaged startup could not be re-smoke-launched independently because the installed app was already running and its single-instance lock correctly intercepted the new process; the live app was left untouched
- this interim local-only state was superseded later that day by the production deployment and v0.7.91 release below

On 2026-07-10 after deploying the repair and publishing v0.7.91:

- website production deployment: `dpl_6mMDfWaEwaZum8GgFQPE7jhbmDQj`, aliased to `https://www.riftlite.com`
- the real linked desktop credential returned 200 from the production embed endpoint with Secure/HttpOnly/SameSite=Lax cookie flags
- the cookie-only owner library returned 200 with the account's replay, and the private canonical replay artifact returned 200
- malformed replay initialization returned `400 invalid_init`, proving bearer authentication completed without creating data
- Playwright rendered the production private library and full replay board with zero console errors
- website `npm test` passed: 22 test files, 136 tests
- website TypeScript, changed-file ESLint, local production build, and Vercel production build passed
- desktop `npm test` passed: 22 test files, 226 tests
- desktop `npm run lint` and `npm run electron:build` passed
- package metadata, packaged ASAR, Windows executable, and `latest.yml` all report `0.7.91`
- installer SHA-256: `519BD766C2CD117843E65C9F21B38FC07BB7188BB2B546D0BD06893D216A69E5`
- GitHub release: `https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.7.91`
- all three release asset sizes and SHA-256 digests matched the local build before publication
- the public Latest updater manifest exactly matched local `latest.yml`, and the public installer length matched `197038616` bytes
- a second packaged process was still intercepted by the live installed app's single-instance lock; the user's running app was left untouched

On 2026-07-10 after publishing the web replay reliability and private-hub ID update as v0.7.92:

- website production deployment: `dpl_5FxjfPGQSyR6sViP94iAwy8fDxjE`, aliased to `https://www.riftlite.com`
- website `npm test` passed: 23 test files, 143 tests
- website TypeScript, ESLint, local production build, and Vercel production build passed
- Playwright rendered the production replay library with seven public replays and opened the newest replay into the complete board/timeline UI
- desktop `npm test` passed: 22 test files, 237 tests
- desktop TypeScript, production build, and Windows installer build passed
- package metadata, packaged ASAR, Windows executable, and `latest.yml` all report `0.7.92`
- installer SHA-256: `7CF38306790E479C858D06D98E4894E80EFFA76DBDEA9F00503A846816DF4FE2`
- GitHub release: `https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.7.92`
- all three release asset sizes and SHA-256 digests matched the local build, and the public `latest.yml` matched exactly
- the packaged process reached the existing installed app's single-instance handoff and exited cleanly with code 0; the running app was left untouched

On 2026-07-10 after repairing room-backed raw-capture association and publishing v0.7.93:

- root cause confirmed for the missing Akali-vs-Akali upload: Atlas WebSocket room `BLD4G` had roughly 1,300 observed frames, but identity-empty DOM match-end evidence could not attach the room-backed session under the v0.7.92 fallback guard
- permanent fix accepts only one session inside the strict temporal window regardless of whether that session learned remote identity; ambiguous and stale sessions remain rejected
- association misses now surface a non-sensitive raw-capture status error instead of failing silently
- focused raw-capture verification passed: 33 tests
- desktop `npm test` passed: 22 test files, 238 tests
- desktop TypeScript, production build, Windows installer build, ASAR metadata, executable metadata, and packaged single-instance smoke handoff passed
- website `npm test` passed: 23 test files, 156 tests
- website TypeScript, ESLint (zero errors), local production build, and Vercel production build passed
- website production deployment: `dpl_8GV89D4xndgR5Hc6orXBoY8g83pP`, aliased to `https://www.riftlite.com`
- Playwright verified the production public library, exact two-card mulligan exchange, and 200 responses for Recruit and Gold token artwork with no replay-player console errors
- package metadata, packaged ASAR, Windows executable, and `latest.yml` all report `0.7.93`
- installer SHA-256: `77A92773D823D165D1D4FE7E3D1D4DD221EEF6B1586E0A38A70638141E114EBE`
- GitHub release: `https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.7.93`
- all three release asset sizes and SHA-256 digests matched the local build, the public `latest.yml` matched byte-for-byte, and the public installer length matched `197487479` bytes
- the installed v0.7.92 process was left running; the unrecoverable in-memory Akali-vs-Akali raw session was not disturbed during build/publication

On 2026-07-10 after publishing the account and private-hub onboarding redesign as v0.7.94:

- anonymous Firebase sessions are no longer presented as linked RiftLite accounts; account UI uses explicit local/linking/needs-profile/ready/reconnect states
- desktop linking, hub invites, Discord verification, Find Match, and team tools share one Google/email + display-name/handle onboarding flow and resume automatically
- website Account and My Hubs pages are live, including exact hub IDs and `riftlite://hubs/...` desktop navigation
- UID associations migrate hub/team membership and ownership, inbox, Discord links, replay indexes, match/message identity snapshots, and cloud backup additively without deleting source records
- existing canonical cloud backups remain authoritative; conflicting legacy backup sources are retained for explicit recovery rather than overwritten
- website production deployment: `dpl_CMzJNmfNHCCWkh9bWRkvvpVDTVx1`, aliased to `https://www.riftlite.com`
- production `/account`, `/hubs`, and `/link-device` returned 200 with expected content; unauthenticated `/api/hubs` correctly returned 401
- website `npm test` passed: 23 test files, 158 tests; TypeScript and production builds passed; ESLint reported zero errors with existing unrelated warnings
- desktop `npm test` passed: 23 test files, 241 tests; TypeScript, production build, and Windows NSIS packaging passed
- package metadata, packaged ASAR, Windows executable, and `latest.yml` all report `0.7.94`
- installer SHA-256: `ACAEFC3098AA9DD040C8CA9DE6B3543A9BD815D100404AB064B3F7B772380C71`
- installer size: `197909184` bytes; blockmap SHA-256: `7DF2C06838A247130A29FBABB31CA9951F1DE691AA4DE559FB959A77A77EB401`
- GitHub release: `https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.7.94`
- all GitHub asset sizes and SHA-256 digests matched the final local artifacts; public `latest.yml` matched the local hash and the public installer returned the exact expected length
- no production profile repair script was run; legacy records repair lazily through canonical profile reads/saves, and the bulk script remains dry-run-first

On 2026-07-10 after publishing BO3 web replay results and animated sideboarding as v0.7.95:

- a real Akali-vs-Akali 0-2 Atlas series stayed in one raw artifact across rooms `QVE3G` and `EQPPL`, normalized as two BO3 games, and uploaded successfully as private replay `rl2_a046c0eb71db28359f52945853f00e6f`
- the captured perspective sideboard delta was verified as 2x Pyke, Dockside Butcher out and 2x Irelia, Fervent in; opponent choices remain hidden
- the real raw capture plus injected privacy-safe match summary restored Game 1 as 5-8 and Game 2 as 4-5 with matching canonical result identities
- desktop focused verification passed: 2 files, 69 tests; full desktop suite passed: 23 files, 243 tests; TypeScript, production build, Windows NSIS packaging, packaged metadata, and single-instance smoke handoff passed
- website focused verification passed: 4 files, 39 tests; full website suite passed: 23 files, 168 tests; TypeScript, changed-file ESLint, local production build, and Vercel production build passed
- website production deployment: `dpl_Aygyah6pQ7d18VuDNDamNrcGH3qb`, aliased to `https://www.riftlite.com`
- authenticated Playwright smoke-tested the private Akali BO3 through Game 2 transition and exact 2x Pyke Out / 2x Irelia In sideboarding with hidden opponent choices and zero console errors
- package metadata, packaged ASAR, Windows executable, and `latest.yml` all report `0.7.95`
- installer size: `197907655` bytes; installer SHA-256: `603B8B300F726EDF626A08841AB674141F78A392C711D0CEFA9AF1F1D443E951`
- blockmap SHA-256: `C1424DD5F1D8FCB04B281DC78418FE60C84388CDD6EE618FC9D23D1BF3DB1058`; `latest.yml` SHA-256: `C18B9DFC81FC591191A61DA48CF8E5CAD3A441D1AB417E0307899FFBB2B93438`
- GitHub release: `https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.7.95`; all three downloaded assets matched local size, SHA-256, and bytes exactly, and the public Latest updater manifest matched local `latest.yml`
- `git diff --check` reported no patch errors in either preserved dirty repository; only existing line-ending warnings remained
- known non-blocking warnings remain: oversized website data-cache payload, large renderer chunk, missing package author, duplicate dependency references, and unsigned Windows binaries

On 2026-07-11 after the web-only BO3 battlefield-transition hotfix:

- the real Akali-vs-Akali raw artifact confirmed Game 1 as BMU/Star Spring versus Ceddidulli/Back-Alley Bar and Game 2 as BMU/Targon's Peak versus Ceddidulli/Star Spring
- Game 2 sideboarding previously inherited Game 1 battlefield selections, option lists, and zones; option-list fallback could then present an unconfirmed or mismatched opponent battlefield before the new selections existed
- game-scoped battlefield state now resets at BO3 boundaries and setup phases, sideboarding/battlefield-pick no longer guesses selections from option lists, and existing stale canonical checkpoints are repaired only when legacy residue is detected
- the existing private replay now shows no assigned battlefields during sideboarding, then reveals BMU/Targon's Peak and Ceddidulli/Star Spring in the correct order without requiring a re-upload
- website focused replay verification passed: 57 tests; the full website suite passed: 23 files, 168 tests; TypeScript, ESLint (zero errors), local production build, and Vercel production build passed
- website production deployment: `dpl_Bf7yr8qAroyjKDBi5nEEUEicvJk8`, aliased to `https://www.riftlite.com`
- authenticated Playwright verified the production private replay through Game 2 sideboarding and battlefield reveal with zero console errors and warnings
- this was a hosted-player-only fix; desktop v0.7.95 remains current and receives the correction automatically in the embedded RiftLite web replay tab

On 2026-07-11 after publishing replay card-state polish:

- Replay V2 now renders added custom labels as Duplicate-style tags and shows explicit white/red counter values, including zero and negative values
- equipped cards are grouped by the exact `attachedToCardId` relationship rather than array adjacency; the equipment renders behind its host with a 27x37px offset so the lower and right thirds remain visible
- reverse-order/non-adjacent equipment, multiple attachments, orphan/self/cyclic relationships, hidden-card fields, detach, and backward-seek reconstruction have regression coverage
- focused replay verification passed: 48 tests; the full website suite passed: 23 files, 174 tests; TypeScript, ESLint (zero errors), local production build, and Vercel production build passed
- website production deployment: `dpl_E2yAdF4tMNFCtJaTjpZrPDyibHg4`, aliased to `https://www.riftlite.com`
- authenticated production Playwright verified the private Akali-vs-Annie replay at 16:15 with `Empowered`, white counter `4`, and Guardian Angel beneath Akali in a 107x149 composite; the only console error was the existing missing `/favicon.ico`
- this was a hosted-player-only release; desktop v0.7.95 remains current and receives the update automatically in the embedded RiftLite web replay tab

On 2026-07-11 after the unified account-connection hardening (local, not yet published):

- the website no longer auto-links a desktop just because the browser already has a signed-in session; it shows the exact selected account and requires explicit confirmation
- reconnect sessions are pinned to the desktop's existing UID, while a deliberate account switch unlinks safely and requires new verification and replay-upload consent
- the desktop verifies exact refreshed-token UID equality plus the website profile, replay library, migration state, and account-bound replay consent before reporting the connection ready
- the Account page now shows the website identity, email, shortened account ID, replay count/upload target, migration health, last verification, and safe verify/repair/switch actions
- failed additive identity migrations remain visible and retryable; migration writes are batched without the previous global record cap, source records are retained, and completion is recorded only after all phases succeed
- turning off automatic web replay upload preserves local raw capture
- current production-account read-only audit confirmed the desktop UID, refreshed-token UID, website profile UID, and replay consent UID all match; 14 owner replays were present and the profile was complete
- full desktop verification passed: 23 files, 245 tests; full website verification passed: 25 files, 180 tests; both TypeScript checks passed; ESLint passed with zero errors and 15 unrelated existing warnings
- no installer rebuild, website build, deployment, data repair, commit, or publish was performed

On 2026-07-11 after the user requested website production plus a local-only installer:

- website production deployment `dpl_ABd8qb4mCoxvBs7Qq9u3aQ26J4Wb` completed and was aliased to `https://www.riftlite.com`
- production `/account` returned 200 and unauthenticated `/api/account/connection` correctly returned 401
- the Windows app was versioned and packaged locally as `0.7.96`; executable metadata and local `latest.yml` both report `0.7.96`
- local installer: `release/RiftLiteBetaInstall.exe`, 197654049 bytes, SHA-256 `6FE0E8D739838DC4A315FB93F59A2ED0286E6AB3CF7CFCB3BCDA069EB613BB41`
- local blockmap SHA-256: `FEDE8F83CB2B9123C408067A7B9951AF2805C5CBEC540C85658536B07A9119CC`; local `latest.yml` SHA-256: `58EF510F059D17687CD90FB85205AA457E7A0BFF0009D5347F83D0E71B063E51`
- no GitHub commit, source push, tag, release, or asset upload was performed; public GitHub Windows release remains `v0.7.95`

On 2026-07-11 after implementing private-hub Discord replay sharing (local, not yet rebuilt or published):

- Replay V2 keeps strict Private visibility owner-only, while Unlisted is anonymously watchable by permanent link and excluded from the public replay index
- the Account page exposes explicit future-replay sharing consent and per-hub selection; enabling it also enables account-bound web upload and forces shared captures to Unlisted
- consent is captured when the Atlas replay session begins, so existing replays are never swept into Discord and mid-match/account changes fail closed
- the authenticated share endpoint verifies replay ownership, current hub membership (including canonical identity aliases), ready canonical data, and configured Discord `feed_channel`
- Discord posts contain player versus player, legend versus legend, BO1/BO3 score, and the permanent link; mentions are suppressed and raw/chat/room/account diagnostic data is excluded
- Firestore delivery claims plus deterministic Discord `enforce_nonce` prevent duplicate posts across concurrent completion and retry; partial multi-hub failures retry without repeating successful destinations
- account unlink/switch, auto-upload disable, backup restore, no selected hubs, and account mismatch revoke sharing consent
- focused website verification passed: 3 files, 16 tests; full website suite passed: 26 files, 184 tests; ESLint passed with zero errors and 15 unrelated existing warnings
- focused desktop verification passed: 3 files, 50 tests; full desktop suite passed: 23 files, 246 tests; TypeScript passed
- no rebuild, Vercel deployment, GitHub operation, Discord command registration, or production data write was performed for this change

On 2026-07-11 after publishing the Discord replay web support and rebuilding locally:

- Vercel production deployment `dpl_2Ja7RDhKwv8iDjyF3jeAKWk8cjAr` completed and was aliased to `https://www.riftlite.com`
- the production public replay list returned 200 and unauthenticated Discord replay-share requests correctly returned 401
- local Windows installer `0.7.97` built successfully; package metadata, executable metadata, and `latest.yml` all report `0.7.97`
- local installer: `release/RiftLiteBetaInstall.exe`, 197718169 bytes, SHA-256 `5CB367ACBA323E3748215C41B2900F44A10CF17BFADF986B90F138F31B9A0403`
- local blockmap SHA-256: `0F25A06AD79613A4DE5EC2A4A8C6969176E57B4A9F968A8B8724BC9EEB7D105A`; local `latest.yml` SHA-256: `F619AAD0B40D052E5BBDF5DA7403D32301AD32D37653EC6AD941EB8BABD791FB`
- no GitHub commit, source push, tag, release, or asset upload occurred; public GitHub Windows release remains `v0.7.95`
- Discord slash commands were not re-registered because the existing `/setup feed_channel` option already supports this feature

On 2026-07-11 after publishing Replay V2 deck-inspection choices:

- the hosted player now reconstructs Atlas `deckPeek` revisions from authoritative canonical events and shows inspected cards arriving progressively in a horizontal choice overlay
- `take_card_from_deck` choices lift out and remain tagged with their exact destination (Hand, Trash, or Base), explicit public reveals receive a reveal animation/tag, and `clear_deck_peek` animates unchosen cards returning to the bottom of the deck
- the presentation retains the full observed candidate set while choices resolve, supports hover/click card inspection, scales its motion at 1x/2x/4x, and reconstructs deterministically during seeking
- privacy-normalized opponent candidates remain card backs; the player does not read raw capture data or infer hidden identities
- the live Kennen-vs-Nasus canonical replay was checked read-only and contains 24 progressive peeks, 16 choices, four clears, and two explicit reveals matching the implemented event model
- focused replay verification passed: 2 files, 21 tests; the full website suite passed: 27 files, 187 tests; TypeScript and changed-file ESLint passed
- local and Vercel production builds passed; website production deployment `dpl_8EQWkWWLwYmwakDWWPF7xu96MTXf` completed and was aliased to `https://www.riftlite.com`
- production Playwright verified the public Kennen-vs-Nasus replay at 0:56.4 showing BMU's first inspected card, Stacked Deck, in the new overlay; the only console error was the existing missing `/favicon.ico`
- no installer rebuild, GitHub commit, source push, tag, release, or asset upload was performed

On 2026-07-11 after publishing the deck-inspection flicker follow-up:

- the inspection overlay is now keyed by its stable player/game/revision identity instead of the current replay event, so the shade and panel remain mounted while cards arrive and choices resolve
- individual entering, reveal, choice, destination, and return animations still update within the one continuous scene
- focused replay verification passed: 2 files, 21 tests; the full website suite passed: 27 files, 187 tests; TypeScript, changed-file ESLint, and diff checks passed
- local and Vercel production builds passed; deployment `dpl_2iDLFxbD5dBRPUeUwiQBgpXPHpAG` completed and was aliased to `https://www.riftlite.com`
- production Playwright moved from the first to second inspected card while preserving the same panel, header, and first-card DOM nodes; only the heading and newly arriving card changed, confirming one stable scene
- the live replay returned 200; the only console error remained the existing missing `/favicon.ico`
- no installer rebuild, GitHub commit, source push, tag, release, or asset upload was performed

On 2026-07-11 after fixing the Discord replay opt-in UX locally (not yet rebuilt or published):

- investigation of Kennen-vs-Renekton and Kennen-vs-Jinx proved the private-hub match-sync pipeline and Discord replay-link pipeline were separate; both replays uploaded privately with zero Discord delivery claims because the sharing master flag remained off
- the old UI allowed `teamuk` to be checked as a destination while leaving the separate master switch disabled, so the apparent opt-in did not bind consent or make captures eligible
- the two-stage control is removed: selecting a hub is now the complete explicit account-bound opt-in, atomically enabling automatic web upload, Discord sharing, and Unlisted visibility; removing the final hub disables Discord sharing
- hub IDs are displayed beside names to distinguish the configured `teamuk` hub from the similarly named stale `team-uk` entry
- replay details now provide a confirmed **Share to Discord** / retry action for existing uploaded replays; confirmation explains that Private becomes Unlisted, the main process re-verifies account ownership, and delivery status persists for safe retry
- the existing website endpoint still enforces replay ownership, active hub membership, configured `feed_channel`, permanent idempotency claims, and suppressed mentions
- focused verification passed: 2 files, 41 tests; full desktop verification passed: 24 files, 251 tests; TypeScript/lint and diff checks passed
- no production Discord message, replay visibility change, installer rebuild, website deployment, or GitHub operation was performed

On 2026-07-11 after publishing reports-channel replay delivery and rebuilding locally as 0.7.98:

- TeamUK's Discord configuration was verified read-only to contain both channels; replay links now use only the configured `reports_channel`, while the ordinary match-feed pipeline remains on `feed_channel`
- the website delivery claim records the reports channel ID, retains replay/hub/guild idempotency, and reports `not-configured` when a hub has no reports channel rather than falling back to the feed
- desktop copy, errors, Account metrics, replay details, and documentation now consistently refer to Discord reports; the one-step per-hub opt-in and confirmed existing-replay share/retry action are included in this installer
- full website verification passed: 27 files, 188 tests; TypeScript, changed-file ESLint, local production build, and Vercel production build passed
- website production deployment `dpl_hCVZQYFasqUWYffK1kRjB8EbFQxH` completed and was aliased to `https://www.riftlite.com`; unauthenticated replay-share requests correctly returned 401 and no Discord message was sent during verification
- full desktop verification passed: 24 files, 251 tests; TypeScript/lint, production build, game-preload build, Windows NSIS packaging, packaged-ASAR metadata, executable metadata, and single-instance smoke handoff passed
- package metadata, packaged ASAR, Windows executable, and `latest.yml` all report `0.7.98`
- local installer: `release/RiftLiteBetaInstall.exe`, 197647569 bytes, SHA-256 `644872BC41498513042211DFBA9FB0AF783971AA7AB712CED5D3694961DDA590`
- local blockmap SHA-256: `1ECEA63C5CFEA73BA06C62D338ECC571C59C233A193E8DD21FACF771A9571731`; local `latest.yml` SHA-256: `0EDF033CD583AC1DEA5BC34D6EF339AFECC2509B2A9E0AFCDB761B0FC4E8C644`
- no GitHub commit, source push, tag, release, or asset upload occurred; public GitHub Windows release remains `v0.7.95`

On 2026-07-11 after implementing the manual dual-perspective Replay Combiner locally (website not yet published):

- `/replays/combine` accepts two Replay V2 links/IDs, requires a signed-in creator plus explicit confirmation that both players consented, and creates a third separate Private replay
- source access uses the existing rules: the creator may use their own Private replay, while another owner's source must be Unlisted or Public; the combiner reads canonical artifacts only and never opens another account's raw capture
- pairing requires the same two Atlas player IDs, opposite capture perspectives, compatible game/series structure, and strong match evidence; room matches also require a format-aware time window plus an authoritative event fingerprint
- the merge keeps one deterministic authoritative timeline, enriches sequence-aligned snapshots/actions with each player's own hidden hand, mulligan, deck-choice, and sideboard data, rejects public-state conflicts, never double-applies secondary commits, and rebuilds checkpoints
- combined artifacts contain immutable source hashes/provenance and coverage diagnostics, use an order-independent retry-safe ID, have no raw artifact, appear in the creator's replay library, and remain compatible with existing visibility controls
- the hosted player marks these as **Combined replay · Open hands**, reveals both known hands/opening/mulligan information, and renders both captured sideboard transitions; normal replay privacy behaviour is unchanged
- the replay library now links to the manual combiner on the website, while the embedded desktop library keeps the prototype entry hidden for now
- full website verification passed: 30 files, 206 tests; TypeScript, focused changed-file ESLint, diff checks, and a local Next.js production build passed
- local browser QA verified the two-link page, consent/auth gating, replay-library entry point, responsive layout, and no new console errors; only the existing AdSense development warning remained
- no website deployment, desktop source change, installer rebuild, GitHub operation, or production data write was performed

On 2026-07-11 after publishing the manual Replay Combiner and rebuilding locally as 0.7.99:

- Vercel production deployment `dpl_984XSDyhodJWnnUFrDhEubcLKcro` completed and was aliased to `https://www.riftlite.com`
- production `/replays/combine` returned 200 with the expected combiner page, while an unauthenticated `POST /api/v2/replays/combine` correctly returned 401
- the desktop package was versioned to `0.7.99`; full desktop verification passed: 24 files, 251 tests, TypeScript/lint, Electron/main build, game-preload build, renderer production build, and Windows NSIS packaging
- package metadata, packaged ASAR, Windows executable, and `latest.yml` all report `0.7.99`; packaged startup reached `startup complete` without a fatal startup failure
- local installer: `release/RiftLiteBetaInstall.exe`, 197647666 bytes, SHA-256 `82145775DCC5A49A52D0304E3E0F0025212A7D5D570B44E065790B086F448643`
- local blockmap: 183158 bytes, SHA-256 `361955D0D73A98BC724F69C0FCD2A1DB3D569EB8FF4F4752D678386425A2861D`; local `latest.yml` SHA-256 `79AA12C383F9EAEC00822DA5DD805BD1D57510F60881DB6AB377A95F4E6CB07D`
- the first npm packaging command forwarded `never` without its flag and failed before packaging; the corrected direct `electron-builder --publish=never` run succeeded, and no GitHub commit, push, tag, release, or asset upload occurred

On 2026-07-11 after publishing replay-library filters:

- the website and embedded RiftLite replay library now filter by player legend, opponent legend, player/opponent/title search, BO1/BO3, and perspective-relative result; owner libraries also filter by processing status and visibility
- sorting supports newest, oldest, player legend A-Z, and opponent legend A-Z; replay cards show the indexed matchup metadata and filtered result counts
- new and combined canonical replays persist a privacy-safe listing summary, while existing ready replays are lazily backfilled from processed canonical artifacts without exposing raw capture data
- full website verification passed: 30 files, 207 tests; TypeScript and changed-file ESLint passed; the Vercel production build passed
- website production deployment `dpl_9a32BkN8EpT6e15ERL7AzfGTzFwQ` completed and was aliased to `https://www.riftlite.com`
- production `/replays` and `/api/v2/replays?scope=public&limit=3` returned 200; all three sampled public summaries contained filter metadata
- no desktop rebuild, GitHub commit, source push, tag, release, or asset upload occurred

On 2026-07-11 after hiding the Replay Combiner entry point:

- the visible **Combine two replays** link was removed from the website and embedded replay libraries, while the direct `/replays/combine` page and combine API remain available for controlled testing
- TypeScript, changed-file ESLint, and 15 focused replay/combiner tests passed; the Vercel production build passed
- website production deployment `dpl_29C2cuptWu9yssU9kXyofBAgYrCy` completed and was aliased to `https://www.riftlite.com`
- production `/replays` returned 200 without the combiner entry text, while the direct `/replays/combine` page returned 200 with the Replay Combiner UI
- no desktop rebuild, GitHub commit, source push, tag, release, or asset upload occurred

On 2026-07-12 after publishing RiftLite 0.8.00 for Windows and macOS:

- the website primary navigation and homepage hero now link directly to `/replays`; TypeScript, changed-file ESLint, and all 207 website tests passed
- Vercel production deployment `dpl_DJ9n2btdpRBw2Tzg6aWpzQ36q3c2` completed and was aliased to `https://www.riftlite.com`; production `/` and `/replays` both returned 200 and the homepage contained the new replay links
- the desktop package uses SemVer `0.8.0`, while customer-facing UI, changelog, tags, and release titles use `0.8.00`; the existing application ID and user-data directory remain unchanged for upgrade/data continuity
- desktop verification passed: 24 test files with 251 tests, lint/TypeScript, Electron main build, game-preload build, renderer production build, Windows NSIS packaging, embedded package metadata inspection, and an isolated 12-second packaged-app smoke launch
- Windows source was published to the separate `windows` remote without replacing its existing history; release commit `b5c06d3a549c9505522a830e8eedc97e7af9a902`, release `https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/tag/v0.8.00`
- Windows installer: `RiftLiteBetaInstall.exe`, 198016069 bytes, SHA-256 `F0387435DE3253ADE15548C071E35C6A2ECF3AECDCA8680CB922BDA34BA51800`; blockmap: 183821 bytes, SHA-256 `94C15BFE9A6FB90141CA495ECC7548EF512E97E9AD7B27B20937B87EF6046AA4`; `latest.yml`: 343 bytes, SHA-256 `94E8F85AE7DC3E87134346FBD62B28EC4E91EC9913634AFF36DD49579FD1507A`
- shared macOS source was published separately to `origin` at commit `90db04a920c439c7b21e74c1f3e36bceda0fb688`; the `mac-v0.8.00` GitHub Actions run passed lint, all tests, packaging, upload, and release attachment: `https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/actions/runs/29186567015`
- macOS release: `https://github.com/cdfpartridge-web/RiftLite-Desktop-mac/releases/tag/mac-v0.8.00`; `latest-mac.yml` reports `0.8.0` and has SHA-256 `F14A4373F8F042E7FF618628731B113593740DB715B55CE05A91FBDC63432243`
- macOS Apple Silicon artifacts: DMG 165154654 bytes, SHA-256 `E27B4EB4661BD4F5917022144AE07ECC63BB6F045D9ED69D075B47ACA17D0F6C`; ZIP 157900070 bytes, SHA-256 `9D773485C2BE6317487B714C1D9F0BE02B1EEC47DEEA367302521FC0F400D3D3`
- macOS Intel artifacts: DMG 173406692 bytes, SHA-256 `7CAD02148C71B940016548A71E7185DE8B0FCDB303C8F5C67F5B8C5D2AAA0941`; ZIP 166100331 bytes, SHA-256 `57C7408B222526662D2A6F86D8E9B4DB09C36F77817CE693EEDC4823EB91F141`

Always rerun after code changes. Useful commands:

```powershell
npm test
npm run lint
npm run build
npm run electron:build
```

Focused tests can be run with:

```powershell
npx vitest run tests/matchSessionTracker.test.ts
npx vitest run tests/captureCoordinator.test.ts
npx vitest run tests/tcgaResolver.test.ts
npx vitest run tests/storeRecovery.test.ts
```

## Build And Release Checklist

1. Confirm the working directory is the canonical `desktop-v06` repo.
2. Confirm `package.json` version and release target.
3. Run `npm test`.
4. Run `npm run lint`.
5. Run `npm run build`.
6. Build Windows only when requested: `npm run electron:build`.
7. Verify `release\RiftLiteBetaInstall.exe` exists and has a fresh timestamp.
8. Smoke-test startup, Home, Play, one platform switch, Settings, Account, Matches, and Replay.
9. Do not push or publish until explicitly requested.
10. When publishing, ensure GitHub release tag and `latest.yml` assets match the app version so in-app updates work for older clients.

## Working Tree Snapshot

The intentional 0.8.00 implementation, tests, assets, and documentation were committed and pushed to both platform repositories. Generated `dist` and `release` outputs remain ignored. Always inspect `git status` before new work and preserve any changes created after this release.

## Recommended Next Engineering Order

1. Capture one short Atlas BO1 from both players, upload both perspectives, and validate the manual Replay Combiner with the two real links.
2. Manually smoke-test account-sync conflict choices with two real devices/test accounts.
3. Smoke-test one Atlas BO3 with identical child-game scores and delayed finalization.
4. Keep the old local Replay Lab hidden; use the first-party website Replay V2 flow for current replay work.
5. Review dependency-audit upgrades separately.
6. Build installers only when explicitly requested.

## Prompt For A Fresh Codex Task

Use this exact starter message in a new task opened in the same workspace:

> Work from `C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06`. Read `docs/CURRENT_STATE.md` first. Preserve the dirty working tree and do not rebuild or publish unless I ask. Continue with: [describe the next bug or feature].

The old task remains useful as an archive, but day-to-day engineering context should come from this file, the current code, tests, diagnostics, and attached logs.
