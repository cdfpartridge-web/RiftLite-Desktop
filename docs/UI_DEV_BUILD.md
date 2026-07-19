# RiftLite UI Dev build

> **Promoted:** The approved UI Dev build was promoted into the normal application as local v0.9.00 on 2026-07-19. See `docs/HANDOVER_2026-07-19_V0.9.00.md`. This file remains as the development-history record.

This worktree is the side-by-side UI development build. It is intentionally separate from the stable desktop workspace so dashboard and navigation changes can be installed and tested without replacing the released app.

## Current UI direction

The approved balanced Home dashboard now supplies the visual system for the whole app:

- the same deep navy surfaces, cyan actions, soft borders, spacing, cards, forms, tables, tabs, empty states, prompts, and modal treatment are applied across every routed feature;
- Play keeps the embedded game dominant while its toolbar, quick setup, capture drawer, deck tracker, and matchup-prep chrome use the shared styling;
- Matches, Stats, Decks, Matchup Lab, Replays, Web Replay, Overlay, Community, Spotlight, teams, Private Hubs, Scorepad, Account, and Settings retain their existing behaviour and routes;
- the collapsible sidebar and compact responsive rail remain available;
- presentation overrides live in `src/renderer/styles/ui-dev-modern.css`, after the stable stylesheet, so the UI Dev theme remains easy to isolate.

## Account confidence and security hardening in dev.12

- Account Sync now shows the local and cloud match/deck counts side by side, the last successful sync, the active-deck state, the data source/device time, and four-stage migration progress.
- Choosing **Keep local data** or **Restore cloud data** first opens a confirmation preview of both copies. No local/cloud conflict choice is applied from the summary screen alone.
- The mandatory packaging gate now includes the account, migration, retained-backup, queue, restore-coordinator, confidence, and two-device conflict suites on both Windows and macOS builds.
- First-launch onboarding continues past the presentation tour until the user successfully saves their first resolved match. Existing histories are reconciled without replaying onboarding.
- Firebase refresh tokens, the legacy replay API key, Scorepad secrets, and the Discord OAuth token cache are migrated out of plaintext storage into Electron `safeStorage`: Windows DPAPI on Windows and Keychain-backed storage on macOS. Plaintext source fields are scrubbed only after the encrypted vault is durable.
- New manual and cloud backups omit credentials, authentication headers/cookies, raw network bodies, URL queries/fragments, and other secret-shaped fields by default. Restoring a sanitized backup preserves the current device-bound account and Scorepad identity.
- Diagnostic bundles are redacted by default, including player names/handles, email addresses, room codes, tokens, raw payloads, and local paths. A separate sensitive export requires both an in-app explanation and confirmation in a native warning dialog.
- Every app-only IPC handler now validates its sender as the exact trusted renderer. Game capture IPC additionally validates the expected provider URL, partition, payload schema and size, JSON depth/node limits, session limits, and per-guest rate limits.
- Embedded Atlas and TCGA guests are recreated with forced preload, sandbox, context isolation, Node disabled, web security enabled, exact provider/partition matching, and narrow navigation, popup, permission, and external-link policies.

Existing retained SQLite recovery `.bak` files are not rewritten or deleted automatically. A backup created before dev.12 can therefore retain an old plaintext value until the normal ten-backup rotation replaces it or the user deliberately removes it; every newly created manual/cloud backup uses the sanitizer.

## Dev.12 validation

- The mandatory release gate passed: lint, 5 account/two-device files with 46 tests, and the full desktop suite with 62 files and 519 tests.
- TypeScript, Electron main/game-preload compilation, the Vite production build, the guarded card-registry check (1,178 unique prints, 1,178 Riot artwork hashes, and seven local special battlefields), and `git diff --check` passed.
- A source-build migration smoke used an isolated profile containing sentinel refresh, Scorepad, API, and hub secrets. After launch, the encrypted vault existed and a binary scan of the complete profile, including SQLite and its recovery backup, found none of the four plaintext sentinels.
- Isolated source and packaged launches rendered the modern Home/account experience and first-match prompt successfully. The real Atlas lobby also rendered under the hardened webview policy without returning to the black-screen failure.
- The unpacked packaged executable identifies as `RiftLite UI Dev` version `0.8.5-ui-dev.12` and completed a clean isolated startup.
- The Windows NSIS installer was built locally with `--publish never`: `release-ui-dev\RiftLiteUIDevInstall-0.8.5-ui-dev.12.exe` (`167362461` bytes; SHA-256 `202CC2208A7908189AEC5A6A8721BA8C7A5CF9351AE483D5143A18F0C8C98EE4`).
- The adjacent blockmap is `152000` bytes with SHA-256 `16C1CC9B4F6FC725B48B5649A72E1474F24B7EEBFA69AA8D60CA650E973E9900`.
- No installer, commit, release, or website deployment was published as part of dev.12.

## Replay media reliability in dev.11

- Local video attachment and Web Replay/raw-capture status updates now patch only their own fields against the latest replay row. Upload or Discord completion can no longer write an older video-less replay over a newly finalized recording, and per-lane attempt ordering prevents a late older request from rolling a successful upload, Discord delivery, or resolved result backward.
- Replay database persistence is serialized, with unique temporary paths, so overlapping saves cannot land out of order or collide within the same millisecond.
- Video finalization waits for the base replay row instead of silently returning when match review arrives first. A bounded failure is recorded if the row never appears.
- Orphaned MediaRecorder WebMs whose headers report `Duration: N/A` are packet-scanned during import, allowing a unique missing replay to be recovered instead of creating a duplicate recording entry.
- The affected Irelia vs Nasus recording was relinked in place after an explicit database backup. Its raw capture, structured events, tracker snapshots, IDs, and other replay metadata were preserved exactly.

## Dev.11 validation

- The focused replay persistence/recovery suite passed 63 tests. The full desktop suite passed 52 files and 480 tests; TypeScript and the Electron/renderer production build passed.
- The packaged executable identifies as `RiftLite UI Dev` version `0.8.5-ui-dev.11`. An isolated packaged launch created only its disposable profile, logged startup completion, and remained healthy for the 12-second smoke window.
- The Windows NSIS installer was built locally with `--publish never`: `release-ui-dev\RiftLiteUIDevInstall-0.8.5-ui-dev.11.exe` (`167201312` bytes; SHA-256 `B642FEDB7318CFA2A1148B8F078F393966F7DE4872DA3543349FB15091BEB45A`).
- The adjacent blockmap is `151357` bytes with SHA-256 `02E5B33198CEDBFAD38A8CA5E35DC834263C07B5121EF1C37C167BFD3BB4E52B`.

## Account, Spotlight, and Discord reporting in dev.10

- Restoring an account backup refreshes the live matches, replays, decks, active-deck notebook, and tracker state immediately; a successful restore no longer requires an app restart before history and the active deck appear.
- Home's featured creator action opens that creator's internal RiftLite Spotlight page. Unknown or missing targets safely fall back to the full Spotlight directory.
- Discord match reporting includes the verified Piltover deck link only when the active deck's normalized Legend matches the captured player's Legend. Mismatched, ambiguous, and local-only decks are omitted, and deck lists are never included.

## Dev.10 validation

- The full desktop suite passed: 51 files, 469 tests. TypeScript, the Electron/renderer production build, the guarded card-registry dry run, and `git diff --check` also passed.
- The website suite passed: 46 files and 324 tests, with one suite and six tests intentionally skipped. ESLint reported zero errors (15 existing warnings), and the Next.js production build passed.
- The website account-status and Discord changes were deployed to `www.riftlite.com` as Vercel deployment `dpl_DSMRPq1342uk2zjZASEeGZAryeH4`; both the production homepage and app-config endpoint returned HTTP 200.
- The packaged registry is byte-for-byte identical to the validated 1,178-print source registry (SHA-256 `ED800FA9F8C325B11AB212C55113384083C71A118EF25D97B44E5825ED5BD957`).
- The unpacked packaged executable identifies as `RiftLite UI Dev` version `0.8.5-ui-dev.10`. Two isolated first-launch smoke runs rendered the guided tour and the completed-tour Home dashboard, then exited cleanly without using the stable or installed UI Dev profile.
- The Windows NSIS installer was built locally with `--publish never`: `release-ui-dev\RiftLiteUIDevInstall-0.8.5-ui-dev.10.exe` (`166358698` bytes; SHA-256 `D779992FDF9C01E9FBFB97424E2671B103C1F22A2980396239A35D55AF278AC1`).

## Card identity and battlefield registry in dev.9

- RiftCodex is used only by the explicit build-time registry updater. Normal desktop capture and Web Replay rendering use the packaged, last-known-good registry and never depend on a live third-party request.
- Registry replacement is atomic and guarded by schema, count, set, image, known-card, and special-battlefield checks. A failed or incomplete refresh leaves the existing packaged registry untouched.
- The tracker now understands current collector-code forms, including overnumbered and signed prints, `A`/`B` rune variants, generated runes and tokens, and set-size suffixes. Resolution stays card-type-aware so a matching number cannot turn a Unit into a Legend, Rune, or Battlefield.
- All 64 currently published collectible battlefield identities are available, along with seven explicitly classified platform-generated battlefields. Exact battlefield codes are carried through Atlas and TCGA best-of-three games, including code-only observations, before being resolved to the existing display-name fields.
- Web Replay preserves exact alternate artwork when it exists and falls back to the canonical Rune artwork when a provider reports a variant code without a dedicated image row.

## Dev.9 validation

- The full desktop suite passed: 48 files, 459 tests. TypeScript, the production Electron/renderer build, and `git diff --check` also passed.
- A guarded live-source dry run validated 1,178 unique prints from 1,300 source rows (OGN 352, OGS 24, SFD 288, UNL 288, VEN 226), 1,178 Riot artwork hashes, and seven local special battlefields without replacing the checked-in registry.
- The packaged registry is byte-for-byte identical to the validated source registry (SHA-256 `ED800FA9F8C325B11AB212C55113384083C71A118EF25D97B44E5825ED5BD957`).
- The unpacked packaged executable completed an isolated first-launch smoke run, rendered the Home dashboard and guided tour at 1704×921, and exited cleanly without using the stable profile.
- The Windows NSIS installer was built locally with `--publish never`: `release-ui-dev\RiftLiteUIDevInstall-0.8.5-ui-dev.9.exe` (`165869167` bytes; SHA-256 `16303FDEA21B248557FB14D305658C6F231BB5D769366377C9646562111B88DD`).

## Account and recovery updates in dev.8

- The desktop account screen now starts the same website-backed Google or email sign-in flow as RiftLite.com. Email/password accounts must verify their email before a desktop can finish linking.
- A successful link resolves to one canonical RiftLite account, so website history, decks, Web Replays, private hubs, and optional device sync stay attached to the same owner. Older alias credentials are upgraded in place without creating a second account.
- Replay upload and Discord sharing now obtain an exact canonical-account token. A stale saved credential cannot upload a replay under a different account.
- Switching or unlinking accounts immediately removes the previous account's private hub/team memberships and cached match views. A late network response from the old account cannot repopulate those caches.
- Device Sync is turned off whenever account ownership changes. Retained-backup recovery serializes cloud writes, confirms the server-side generation before changing local data, reconciles a lost success response, keeps uncertain staging data, and never overwrites the current backup before the tester chooses which copy to keep.

## Dev.8 validation

- TypeScript, the production renderer build, and the full desktop suite passed: 44 files, 414 tests.
- The current Windows NSIS installer target is `release-ui-dev\RiftLiteUIDevInstall-0.8.5-ui-dev.9.exe`; build evidence is recorded after validation below.
- The packaged executable identifies as `RiftLite UI Dev` version `0.8.5-ui-dev.9`; it keeps the separate app ID, executable, profile, deep link, and disabled updater described below.

## Tester fix in dev.7

- Replay video is no longer covered by a dark rectangle. The always-mounted Draw/annotation layer remains transparent instead of inheriting the modern dashboard-card background; Draw controls and saved annotations are unchanged.

## Dev.7 validation

- TypeScript passed and the full desktop suite passed: 42 files, 385 tests.
- The Windows NSIS installer was built locally with `--publish never`: `release-ui-dev\RiftLiteUIDevInstall-0.8.5-ui-dev.7.exe` (`164422306` bytes; SHA-256 `BCAC64D65F636A6ADDFCE690F3DA5420EB298C46B06E11E281F59A1FAD1686DB`).

## Tester fixes in dev.6

- Match review popups can scroll again at 1080p. The modern theme no longer overrides the base overflow rules, which also restores scrolling in match details, replay export, and community deck snapshots.
- Atlas card faces use Chromium's sharper low-interpolation rendering at low display density. The rule is restricted to real cards inside the Atlas game board and does not change webview zoom, viewport size, provider sign-in pages, adverts, avatars, or TCGA.

## Dev.6 validation

- TypeScript passed and the full desktop suite passed: 42 files, 384 tests.
- A native 1920x1080 probe confirmed DPR 1, game zoom 1, and identical guest/host pixels, ruling out persistent RiftLite scaling. Atlas's fractional responsive card sizing is the source of the slight softness.
- In the packaged app, a real 1506px-tall BO3 review form scrolled from top to bottom with trusted wheel input and exposed its footer. Atlas loaded without an empty shell or recovery cover; the sharpening rule applied at DPR 1, while an identical TCGA probe retained normal rendering.
- The Windows NSIS installer was built locally with `--publish never`: `release-ui-dev\RiftLiteUIDevInstall-0.8.5-ui-dev.6.exe` (`164479576` bytes; SHA-256 `3096831AE6520ACF73B44D3C1B786F320B62CFFF85F43C7F57BC76D5469C05F3`).

## Tester fixes in dev.5

- Atlas keeps its startup cover monotonic after the lobby first reports ready, so Clerk sign-in and other SPA route transitions cannot re-arm the cover over usable content.
- Atlas now binds Electron webview lifecycle and IPC events by their exact hyphenated names. If Atlas reports an empty app shell before a match starts, UI Dev performs one bounded webview remount; it never remounts an active match, and the shared partition preserves sign-in state and local data.
- Collapsing the sidebar also compacts the Play provider/action toolbar. The top-right action is now the direct **Stop match** control.
- Settings is grouped into four keyboard-accessible disclosure sections while keeping closed controls mounted so in-progress values are preserved.
- Signed and overnumbered print codes, including `A`/`B` rune variants, resolve to canonical card identities in the desktop tracker. The corresponding Web Replay artwork/sideboarding fix was deployed to `www.riftlite.com` as Vercel deployment `dpl_966smHg4n2CEb1X92vCfaa82Nrc6`.

## Dev.5 validation

- TypeScript passed and the full desktop suite passed: 40 files, 381 tests.
- The packaged app opened the real Atlas **Sign in** control and reached `https://play.riftatlas.com/sign-in?redirect_url=%2F`; the Clerk form was present, the RiftLite startup cover remained cleared, and no failed-load, empty-shell, or fallback-reload event occurred.
- Discord, Google, and Twitch provider pages use same-tab redirects rather than popups; RiftLite has no game-webview navigation restriction that blocks those routes. Completing a real provider login remains a manual account-level check.
- The Windows NSIS installer was built locally with `--publish never`: `release-ui-dev\RiftLiteUIDevInstall-0.8.5-ui-dev.5.exe` (`164470887` bytes; SHA-256 `F644728188C8A794E07FF453E044BCB897E326407C2B8387C5E7F6F473AAD178`).

## Dev.4 validation

- TypeScript passed and the full desktop suite passed: 39 files, 375 tests.
- The packaged app rendered the complete Atlas lobby with a fresh isolated profile and with a safe copy of the persisted Atlas cache/local-storage partition that had shown the blank shell.
- A packaged recovery probe dispatched the real `ipc-message` event name: the original guest was replaced once, the replacement lobby became ready, the loading cover cleared, and the delayed main-process fallback correctly did not race the renderer remount.
- The Windows NSIS installer was built locally with `--publish never`: `release-ui-dev\RiftLiteUIDevInstall-0.8.5-ui-dev.4.exe` (`164260935` bytes; SHA-256 `6A78800478FAF09831B0F71D383EF15FF9AE0180F3EFA3B78AC6AB63C33BF92E`).

## First-launch tour

A fresh UI Dev renderer profile opens a six-step guided tour through Home, Play, Review, Prepare, Community, and Utilities. The tour supports Back, Next, Skip, Finish, Escape, and arrow-key navigation. Progress resumes safely if the app closes mid-tour.

Tour state is versioned and stored only in renderer `localStorage`. It is not included in account sync, Firebase, manual backups, or the stable profile. Settings contains:

- **Replay tour**, which runs the tour without changing the saved completion state;
- **Show next launch**, which resets only the tour key so first-launch guidance appears after the next restart.

The existing Play quick-setup flow is deliberately preserved and remains independent of the presentation tour.

## Workspaces

- Stable / quick bug fixes: `desktop-v06`
- UI development: `desktop-ui-dev`
- UI development branch: `ui-redesign-dev`

The UI worktree began from the same commit as stable and includes a byte-for-byte copy of the local v0.8.05 tester fixes that were present when it was created. Changes made after that point do not cross between worktrees automatically.

## Side-by-side identity

| Layer | Stable | UI Dev |
|---|---|---|
| Product | RiftLite Beta 0.8 | RiftLite UI Dev |
| App ID | `com.riftlite.desktop.beta06` | `com.riftlite.desktop.uidev` |
| Windows executable | RiftLite Beta 0.8 | RiftLite UI Dev |
| Shortcut / uninstaller | RiftLite Beta 0.8 | RiftLite UI Dev |
| Local profile | `%APPDATA%\RiftLite Beta 0.6` | `%APPDATA%\RiftLite UI Dev` |
| Deep link | `riftlite://` | `riftlite-dev://` |
| Build output | `release` | `release-ui-dev` |
| Auto-update | Stable GitHub releases | Disabled |
| Usage heartbeat | Release channel | Disabled |

Screenshots, backups, replay bundles, and replay videos also use `RiftLite UI Dev` folders, so local media is not mixed with stable media.

## Safety defaults

A fresh UI Dev profile starts in local-only mode:

- public community sync is off;
- account cloud sync is off;
- raw replay upload is off;
- legacy RiftLite data is not imported automatically;
- production usage analytics and the stable updater are disabled.

Account linking, private hubs, community sync, Discord delivery, and Web Replay remain available for explicit testing. Those features use production services when enabled, so use a tester account where possible and avoid capturing the same live match in both apps at once.

The stable `riftlite://` association is never registered by UI Dev. Website account linking still works because it uses a polled website session rather than the desktop deep link.

## Local workflow

```powershell
cd "C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-ui-dev"
npm ci
npm run electron:dev
```

Validation:

```powershell
npm run lint
npm test
npm run build
npm run electron:smoke
```

The smoke command compiles the Electron main process, starts the Vite renderer, launches an isolated `--riftlite-smoke-test` window, and exits after the configured screenshot hook. `RIFTLITE_UI_SNAPSHOT_TOUR_ACTION`, `RIFTLITE_UI_SNAPSHOT_VIEW`, `RIFTLITE_UI_SNAPSHOT_PLATFORM`, `RIFTLITE_UI_SNAPSHOT_COLLAPSED=1`, and `RIFTLITE_UI_SNAPSHOT_ATLAS_WAIT_MS` are available for local route, provider, collapsed-Play, Atlas timing, and tour visual checks.

Build the local Windows installer without publishing:

```powershell
npm run electron:build
```

The installer is written to `release-ui-dev\RiftLiteUIDevInstall-0.8.5-ui-dev.12.exe`. The build script always passes `--publish never`, and the package contains no GitHub publish feed.

## Stable hotfix workflow

Make urgent released-app fixes in `desktop-v06`. Validate and release them from the stable workflow. Then deliberately port the relevant commits or patches into `desktop-ui-dev`; do not copy the entire stable folder over this worktree.

Likewise, UI Dev changes should not be merged into stable until the redesigned build has been reviewed and approved.

## Concurrent-use caveats

Both apps can be installed and opened together. However:

- global screenshot and replay hotkeys can only belong to one process at a time;
- running capture in both apps can create duplicate local matches;
- enabling production sync in both apps can create duplicate community records;
- embedded TCGA and RiftAtlas sessions are intentionally separate;
- the overlay service will select another free local port if the preferred port is already in use.
