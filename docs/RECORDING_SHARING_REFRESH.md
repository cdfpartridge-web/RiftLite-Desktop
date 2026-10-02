# Recording and sharing refresh — local implementation

**Published 2 October 2026:** The completed work below is now included in **v0.9.80** for Windows and both Mac architectures. The supporting website changes are live. [Release receipt](./RELEASE-2026-10-02.md). This supersedes the local-only status of the dated implementation and test-installer checkpoints below.

The original local checkpoint contained the desktop refresh on `codex/recording-sharing-refresh`, based on `98182cb`, and retained version **0.9.79** without publication. The dated sections below describe those development checkpoints.

## User flow

- Open **Recording & sharing** in the sidebar to configure interactive replay platforms and privacy, local video and microphone recording, and Discord destinations.
- Open **Review → Replays & videos** to select a game. Interactive replay, video recording and game log have independent availability and actions. Local games and the latest account-owned online games share the same chronological list.
- **Watch replay** opens the existing web player inside the desktop using its account-scoped embed session. Video playback, annotations, voice notes, export and local recovery tools remain available.
- **Share to Discord** chooses destinations for this game only. It does not enable future automatic sharing. Discord setup distinguishes member verification, hub membership and a configured reports channel.
- Automatic interactive uploads can finish before result review. Discord posting waits for the saved result. Upload activity has a direct **Review result** action.
- **Play** distinguishes enabled preferences, an armed video source, active recording and microphone recording.

Existing capture, privacy and destination preferences are preserved. No migration enables sharing, uploads or microphone recording.

## Local testing

`npm run lint`, `npm test` and `npm run build` run the desktop checks and build. Build output is in `dist`; this is not a published installer.

The component preview is in `output/recording-sharing-preview/`. Serve the checkout with Vite and open `/output/recording-sharing-preview/index.html`. Its toolbar exercises connected/disconnected accounts, missing Discord setup, upload failure, partial and cloud-only replays, pending result review and sharing. It uses sample data and in-memory APIs. Its interactive replay settings slot is explicitly a fixture; full desktop smoke snapshots cover the actual integrated route.

The isolated Electron smoke helper and its screenshots are under `output/recording-sharing-smoke/`. Smoke mode uses a separate profile and blocks external requests. It must assert the requested route is visible and the guided tour is absent; startup readiness alone does not prove navigation succeeded.

## Supporting website change

The companion changes remain local in the `opening-turns-lab-20260923` website checkout. The replay Discord endpoint accepts a saved reviewed result bound to the owned capture and canonical player perspective, without changing replay source events. Explicit retries can recover after destination setup is corrected, while successful posts remain idempotent.

Both desktop and website changes are needed for the full reviewed-result and terminal-retry behavior. The local compatibility fallback below preserves ordinary sharing against the existing website. This task does not authorize a release.

## Current limitations

- The account-owned replay endpoint returns at most 100 entries. The desktop states this cap and preserves all local history. No title/date guessing is used to join records.
- Videos stay on the recording computer. Cloud-only games do not imply an available local video.
- Production Discord posting and live account uploads were not performed during local validation.

## Local follow-up — stuck deliveries and Discord dialog, 1 October

Read-only inspection of the installed profile confirmed the reported LeBlanc mirror was still marked completing from 22 September. LeBlanc–Viktor and Kennen–Ornn were already ready online; only their Discord posts had failed because the website lacked the reviewed result. Older failed Discord posts repeatedly occupied the limited retry batch because ordering used their original upload timestamps instead of their recent delivery attempts.

The released website's strict Discord request schema also rejects the refresh's new reviewed-result fields as `invalid_hubs`, even for valid destinations. Local recovery now handles that compatibility case without silently posting a different result. Supporting website changes are still required for sharing corrected or previously missing results and retrying terminal server-side deliveries.

Upload activity now offers **Keep local only** for interrupted operations once the service confirms no operation is running. Ready online replays instead offer **Stop Discord retries**, preserving the online replay and prior posts. **View progress** opens and scrolls to these controls. Neither action changes future recording or sharing preferences.

The Discord dialog now uses a bounded viewport layout with a scrollable middle section and persistent header/footer. The real component was verified with 24 destinations at 640×480, 600×980 and 1280×720, including keyboard/wheel scrolling, error text, focus restoration and background scroll locking. Evidence is in `output/dialog-scroll-preview/`.

The follow-up local Windows installer is `output/installer-delivery-fix-20261001/RiftLiteBetaInstall.exe`, still version **0.9.79**, built at 16:01 BST on 1 October. Size: **159,453,762 bytes**; SHA-256: `C6B676624241E99D6C16D47C1E7A061EFE7719E49F303769500B41F7BEF70349`. TypeScript, the 82-test account-sync gate, **231 files / 2,476 tests**, production build, Windows artifact verification and isolated packaged startup passed. The earlier local candidate is preserved. No deployment, installation, live posting or production-profile repair was performed.

## Automatic crash diagnostics — local follow-up, 1 October

The desktop now starts local native crash recording before creating windows, with uploads disabled. Synchronous text diagnostics record startup/errors, renderer and child-process exits, window hangs, quit/update requests, slow database operations, event-loop lag, and runtime/process-memory samples every 15 seconds. Only the primary app instance writes session markers. A successful actual exit marks the session clean; a cancelled quit request does not. On restart, an unfinished marker is reported as an unexpected exit, which can also mean forced termination or power loss.

Settings → Privacy, support & updates → **Crash diagnostics** shows logging health, the previous unexpected exit and **Export crash log** / **Open logs folder**. Export contains sanitized text, runtime details and native dump filename/date/size metadata. It excludes raw capture traffic, settings/credential files and native memory-dump contents. Nothing is uploaded automatically. Owned text diagnostics retain up to five sessions within 5 MiB; native dump storage is managed separately by Electron Crashpad. Files are under the existing user-data folder's `Crash Diagnostics` directory.

Read-only investigation of the user's existing profile did not establish the cause of the current exits: startup on 1 October completed at 15:38 BST and capture diagnostics ended at 15:57 BST without an exit reason. No matching current Windows crash, hang or resource-exhaustion report was found. This instrumentation supplies evidence for the next recurrence; it does not claim to fix an identified crash cause.

An isolated Electron native-crash test verified dump creation, synchronous breadcrumb survival, unexpected-exit detection, later clean-exit detection, retained incident history and sanitized export with uploads disabled. Harness and evidence are under `output/crash-diagnostics-smoke/`. The packaged smoke gate additionally verifies that the real application's automatic sample and clean-exit marker were persisted. UI fixtures under `output/crash-diagnostics-preview/` cover status/write failures and export success, cancellation and failure.

The latest local Windows installer is `output/installer-crash-diagnostics-20261001/RiftLiteBetaInstall.exe`, still version **0.9.79**, including the earlier refresh/delivery/dialog fixes. Size: **159,463,716 bytes**; SHA-256: `5BF193D7827C1EC490D0CE2D53B3ECD1F8A74E7F5230C7A7F55C773CCD821FD0`. TypeScript, the 82-test account-sync gate, **233 files / 2,499 tests**, production build, repeated isolated native-crash test, Windows artifact checks and packaged startup all passed. The content audit matched all **322 compiled files and 60 resources**; app.asar SHA-256: `C42C798C86AEA40F5229C189B9C7129B3212C25C85984382A2A80D07D5097840`. Evidence is in that installer's output directory, including `validation-final.log` and `package-content-audit.json`. No installation, deployment or production-profile mutation was performed. The next real gameplay incident remains the required evidence for identifying the original cause.

## Account, Your groups and Game details — local follow-up, 1 October

Implemented the user's selected recommendations 2, 4 and 5. Account now has one identity/status card, Profile & privacy, an explicit Back up my data section, and collapsed Troubleshooting. Backup replacement previews and consent behavior are unchanged. Local capture naming remains distinct from the public account handle, and match-result sharing is labelled separately from account backups.

Community → Your groups has Teams, Private hubs and one Invitations inbox. These retain separate membership sources and management actions. The inbox handles account changes, expired invites, stale responses and partial service failures. Accepting an invitation does not enable automatic sharing. The Find match page links to Your groups instead of repeating its team-management surface; existing private-hub routes still open the hubs tab.

Home, Matches, personal Stats and Replays & videos now open one Game details overlay with Summary, Replay & video, Decks and Notes. The source screen stays mounted so filters and position survive closing. Local records, owned online replays and combined-match recordings are associated through exact IDs. Replay tools, game logs, deck history, training handoffs, editing, export and deletion remain available. Media pauses when its tab is hidden; game-log inputs are stable across background updates; child dialogs have focus containment and Escape handling. Community statistics retain their existing read-only drilldowns.

The latest local Windows installer is `output/installer-account-groups-games-20261001/RiftLiteBetaInstall.exe`, still version **0.9.79**, including the earlier recording/sharing, delivery recovery and crash diagnostics changes. Size: **159,474,888 bytes**; SHA-256: `40CBA66F90D6E00C54FC099938315B8E14A65D33EBD9405E4C5E9CF702618A15`.

Validation passed: TypeScript, the **82-test** account-sync safety gate, **236 files / 2,537 tests**, production build, Windows artifact verification, and isolated packaged startup (including diagnostics persistence). The content audit matched **328 compiled files and 60 resources**; app.asar SHA-256: `2B911FC4587FC55C3C025F504C70AFA04FF81972F674E87FA4E5610E62F771D6`. Logs and the byte-by-byte audit are in the installer directory.

Actual built-app UI checks used an isolated dummy profile with external requests blocked. Home/Matches/Stats/Replays opened the correct game; a match-result filter survived returning; nested export/delete/log dialogs trapped focus and closed without losing the parent. Account and Your groups routes and disconnected guidance passed without renderer exceptions. Evidence: `output/account-groups-game-qa/run-1790871435172/`. Hidden-window screenshots use Electron native capture with a compositor warm-up; earlier failed browser screenshot attempts are retained separately. Account component checks covered connected, profile-required, expired and migration-attention states plus both backup review cancellations with zero mutations. Group component checks covered both invitation kinds, partial failures, expiry and narrow layouts. Live invitation acceptance and production posting were not exercised.

No version bump, installation, deployment, live posting, production-profile mutation, Home redesign or Training-navigation redesign was performed. Earlier local installer candidates are preserved.

## Play toolbar and fresh card scan — local follow-up, 1 October

Web replay, video and microphone indicators now sit inside the existing Play top bar. The separate row below it is removed. Narrow toolbars show concise status text while keeping full accessible labels and tooltips, and clicking an indicator still opens Recording & sharing. Fullscreen hides the whole toolbar as before. Platform icon buttons now retain names when their labels are hidden. Actual built-app checks at 1,366, 1,000 and 900 pixels and with the sidebar collapsed confirmed one row without overflow; evidence is in `output/topbar-cards-qa/run-1790873323410/`.

The [1 October card audit](./CARD-SCAN-2026-10-01.md) added **22 prints / 18 new card names**, bringing Radiance to **110 prints** and the complete registry to **1,299**. Mordekaiser, three battlefields, champion cards and distinct promotional/signed/alternate artwork are supported. Every previous print identity remains. Lost to the Sands is corrected with its prior spelling retained as an alias. The separate website checkout has matching replay/training data and TCGA promotional/signed-code recognition; those website changes remain local.

Desktop verification: TypeScript, **82 account safety tests**, **236 files / 2,538 tests**, and the production build passed. Web verification: **233 targeted tests**, TypeScript and diff checks passed. All 22 new artwork URLs and the corrected card's artwork returned valid images. Full official-gallery coverage found no missing non-Radiance identities. No version, installed profile or live deployment was changed.

The final website compatibility follow-up additionally passed **88 replay tests** and TypeScript. Both replay renderers recognise the old and corrected RAD-013 names without a collector code, while preserving exact-code/captured-art precedence and hidden placeholders. The legacy renderer also recognises the three new battlefields by name. These web-only source changes are not a production deployment.

The latest local Windows installer is `output/installer-topbar-cards-20261001/RiftLiteBetaInstall.exe`, version **0.9.79**, including all preceding local changes. Size: **159,479,498 bytes**; SHA-256: `6FC410E24206CCE8D862018A3C7DEBA22B8DBA3E1DED3312B68D55886E7DFF46`. Windows artifact checks and isolated packaged startup passed. The package audit matched **328 compiled files and 60 resources**, including the refreshed registry; app.asar SHA-256: `E875964DB020248D61DD5AA26507483A4A9F2C211A129864A3150B46338F0F8A`. Build, gate, verification and UI receipts are in that installer directory. The previous candidate is retained separately.

## Finding and finishing deferred reviews — local follow-up, 1 October

A tester could not find matches kept with Review later or mark them finished. The existing defer/confirm persistence works: Review later stores a pending row and suppresses its automatic popup, while Save match confirms it. The problem was discoverability: public v0.9.79 calls the action Edit; the local refresh put it under More → Edit match or inside Game details. There was no review-status filter, and the default current-season filter could hide older deferred games. Sync → Pending refers to delivery, not unfinished reviews.

Matches now has an always-visible **Needs review (N)** control alongside All matches. Entering it clears other filters and includes all seasons. Pending and incomplete captures have a direct **Review result** button; Game details and Replay details use the same rule. Guidance explains that Save match finishes the review, and Review later confirms where to find it again. A saved review leaves the queue and stays in history. Deleted/combined originals and completed matches waiting on sync are excluded from the review count. Confirmation and seat validation remain unchanged; no bulk completion or database migration was added.

Built-app testing also reproduced a pre-existing issue when automatic capture confirmation is enabled (`confirmationEnabled: false`): explicitly reopening a pending review immediately submitted it through the automatic capture effect. Explicit review actions now mark the open draft as user-controlled, keeping the form open until the user saves or defers it. Advancing to the next queued capture clears that marker so normal automatic capture confirmation continues. This is a verified additional defect, not a claim about the tester's unknown settings.

TypeScript, the 82-test account-sync safety gate, all **236 files / 2,542 tests**, and the production build passed. Regression checks exercise real history filtering across seasons, completion transitions, unchanged statistics rules and exclusion of pending uploads, deleted records and combined originals.

Isolated built-app UI tests passed with confirmation both disabled and enabled. They verified clearing conflicting filters, retrieving older-season captures, explicit review staying open, missing-seat validation, saving a review updating both the count and durable status, edited notes surviving Review later and a full restart, the empty queue and all three fixture matches remaining in history. There were no renderer exceptions. Evidence: `output/pending-review-qa/run-confirm-off-1790889857203/` and `output/pending-review-qa/run-confirm-on-1790889786901/`. The final hidden-window visual check disabled transitions only in the fixture DOM to avoid capturing paused animation frames; selected-state styles were verified against the accessible button state. All UI work used disposable local profiles with external requests blocked; no production matches or preferences were changed.

The latest local Windows installer is `output/installer-pending-review-20261001/RiftLiteBetaInstall.exe`, still **v0.9.79**, including all earlier local updates. Size: **159,483,171 bytes**; SHA-256: `482D53F8054E533FDD2FA8F55B05A9B110E146ED4DE5F42EE90621CAF60113A4`. Windows artifact checks and isolated packaged startup passed. The package audit matched **328 compiled files and 60 resources**; app.asar SHA-256: `FEFA85E579423F2062D8FD304FDF726F439001359B93D59F831D4CAC90264DEE`. Logs, UI receipts, a queue screenshot and the content audit are in that candidate directory. Previous installers remain preserved; no version bump, installation or deployment was performed.

## Replay library action visibility — local follow-up, 2 October

Moved Recording & sharing, Browse online replays and Refresh online games into the replay library heading, directly below the introduction. Setup now uses the cyan primary button; browsing has a stronger blue background and border. All three controls have 44-pixel minimum height, larger icons and clearer spacing. Refresh sits at the right on wide windows and joins the left-aligned wrapped group on smaller windows. Its existing loading/account gate remains, with an explanatory tooltip when the account is not connected. Navigation and refresh behavior are unchanged.

TypeScript and the production build passed. Isolated real-app UI checks at 1,366, 1,100 and 900 pixels verified 44-pixel controls, alignment, no horizontal overflow, both navigation actions, keyboard order and the signed-out refresh gate, with no renderer exceptions. Screenshots and the receipt are in `output/replay-actions-qa/run-1790941400920/`. The existing responsive sidebar behavior is retained. No new unit tests were added for this presentation-only change.

The latest local Windows installer is `output/installer-replay-actions-20261002/RiftLiteBetaInstall.exe`, still **v0.9.79**, including the previous local updates. Size: **159,480,475 bytes**; SHA-256: `72EC0DA4FF63F631DBD31756B40A21789121F722F29EB4DD89F4ECB615ECC550`. Windows artifact checks, isolated packaged startup and the content audit passed: **328 compiled files and 60 resources** match the fresh build. app.asar SHA-256: `9250BD2319FEAC16E4FAFB8806239F933ED85E53F96F8F37A659280597CE68BE`. Logs, UI checks and a preview screenshot are in the candidate directory. Nothing was installed or deployed; previous installers are preserved.

## General responsiveness investigation — local follow-up, 2 October

The user reported sluggishness throughout the app. Read-only crash-diagnostic inspection found real main-process event-loop pauses, commonly 150–257 ms at the upload-status polling cadence. Available memory was roughly 12 GiB during the sampled session, so these measurements did not indicate memory exhaustion. Game completion also produced individual database writes of 90–666 ms; persistence durability was left intact.

The upload activity poll was checking every capture's parent separately. In a read-only, in-memory snapshot of the user's database, 495 manifests required 1,017 SQL queries and repeated match/replay JSON parsing per poll. Diagnostics now takes one batch snapshot, using existing library caches and one purge-tombstone query. The repeated parent check improved from **222.67 ms to 0.48 ms median** with identical decisions for all 495 manifests (465 active). A cold match snapshot also populates the cache using the normal library ordering. Cold loading and manifest file reads still have a cost; these figures measure the repeated parent check, not the whole diagnostic request. Upload and sharing operations retain their live parent checks. Deleted, purged, orphaned and mismatched parents remain rejected; a missing replay may still use its active match for crash recovery, and parentless recovered journals retain their existing exception. No production profile data was changed.

The renderer also rebuilt the active-match array on every root status update, invalidating replay search and other derived data. That array is now memoized. Fixed legend alias needles and canonical keys are prepared once instead of sorting and normalizing the whole catalog for every match. Removed an unused eager replay model in the library and deferred the game-details replay model until Replay & video is first opened, preserving its mounted state on later tab switches.

An isolated production-build Electron comparison used the same 600 synthetic matches and 600 replays, with about 50 MB of replay JSON before store compaction. Over 30 capture-health updates in six seconds, renderer scripting fell from **1,860.75 ms to 73.84 ms**, and long tasks fell from **31 to 0**. Median navigation times across three rounds: Replays & videos **198.7 → 35.5 ms**, Matches **406.3 → 171.4 ms**, Stats **102.2 → 20.2 ms**, and game Summary **68.8 → 5.7 ms**. First Media selection performs the deferred work; combined median Summary plus Media times fell from **79.1 → 20.2 ms**. These timings describe this controlled fixture, not a guarantee for every machine or game. Both runs had no renderer exceptions and used disposable profiles with external requests blocked.

Evidence: `output/performance-20261002/baseline-1790969488217/result.json`, `after-1790970009087/result.json`, their CPU profiles and the reusable harness. The legend helper has 26,258 baseline parity comparisons; its standalone 1,200-name batch improved from 27.73 ms to 1.04 ms median. The read-only parent-check benchmark and aggregate receipt are in the same output folder. Source regressions cover catalog aliases, precedence, boundaries, unknown names, Master Yi variants, parent lifecycle rules, mutation races and recovered journals. Existing Radiance and local UI changes are preserved.

Final TypeScript, the 82-test account-sync gate, all **236 files / 2,549 tests**, and the production build passed. Separate isolated UI checks confirmed Summary leaves replay controls unmounted initially, the first Replay & video visit renders the actual controls, later tab switches preserve the replay, and closing/reopening starts lazily again. No renderer exceptions occurred. Receipts: `output/performance-20261002/comparison.json` and `correctness-1790970123368/result.json`. The final renderer bundle matches the measured build byte-for-byte, SHA-256 `8AC69ADE85EFF1D36FE8DFA13262C8019610C61632F307CF9213D19C7D7F3AFD`. Final gate/build logs are in `output/installer-performance-20261002/`.

The latest local Windows installer is `output/installer-performance-20261002/RiftLiteBetaInstall.exe`, still **v0.9.79**, including all earlier local updates. Size: **159,484,332 bytes**; SHA-256: `21DA58F13DA44ECE9F7CE9ECCEB8550C29E0A47B6D06BEDF50E6F404AAF3696C`. Windows artifact verification, isolated packaged startup and the content audit passed; **328 compiled files and 60 resources** match the final build. app.asar SHA-256: `4C5498C57B0A2918F8730D6AD559F91B1076ADD88F713BE946719769CA89015A`. Previous installers are retained. No version bump, installation or deployment was performed.

## Earlier refresh validation

- Desktop TypeScript and full local build passed.
- 231 desktop test files, 2,462 tests passed.
- 28 supporting web tests, web TypeScript and targeted ESLint passed.
- Full desktop smoke verified both routes, IPC readiness and no guided-tour obstruction in an isolated profile.
- Browser fixture checks verified missing-channel recovery guidance, independent asset statuses, video settings, and one-game sharing without enabling automatic sharing.
- Build/test logs are in `output/recording-sharing-validation/`.
