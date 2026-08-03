# Replay V2 desktop integration

RiftLite Web Replay is user-facing. Atlas and TCGA first-party upload remain off until the user links a RiftLite account and explicitly enables a provider in **Review > Web Replays**. The old local reconstructed Replay Lab and third-party RiftReplay credentials remain separate from this first-party flow.

## User-facing behaviour

- **Review > Web Replays** is the single setup, status, and recovery centre. Account and Settings provide concise links back to it.
- Atlas and TCGA have independent opt-ins. Enabling the first provider for an account starts at Private visibility; disabling one never silently changes the other.
- Upload and Discord consent can always be revoked locally, including while website account verification is unavailable. Removing the final Discord destination returns future replays to Private visibility.
- Consent is bound to the linked RiftLite account UID. Switching accounts requires a new opt-in, and unlinking revokes it.
- First-party visibility defaults to private and may be changed to unlisted or public.
- Unlisted replays are excluded from the public library but remain watchable without an account by anyone holding the permanent link.
- Discord replay sharing is a separate account-bound opt-in. The player selects one or more joined private hubs; shared future captures are forced to Unlisted and posted only through each hub's configured bot `reports_channel` after server-side ownership and membership checks.
- Discord messages contain only the two displayed player names, legend matchup, format, score, and permanent player URL. Raw capture, chat, room codes, account IDs, and diagnostics are never sent. Existing replays are not automatically backfilled.
- Share retries use both a Firestore delivery claim and a deterministic Discord nonce. Successful hub posts are not duplicated when another selected hub is unavailable.
- The **RiftLite web replay** desktop tab bootstraps a short-lived HttpOnly owner session and embeds the account's website replay library.
- Website mutations and uploads still require a Firebase bearer token; the embed cookie grants read-only owner listing and private playback only.

## Capture and local persistence

- The wire payload remains `riftreplay-raw-capture` version 1 so existing captures and ingestion tools stay readable.
- RiftLite adds optional `capture.lifecycle.games` and `capture.lifecycle.phases` arrays. Each entry carries an inclusive `fromSeq`/`toSeq` source range; phases preserve the exact Atlas phase and also carry a normalized phase.
- A common Atlas `seriesId` is authoritative. Per-game match, room, replay, and capture-session IDs are retained as child identity evidence and do not split a BO3 series.
- Identity-free matchmaking/prelude frames start in a provisional transport session. A later authoritative series/previous-room signal merges a genuine BO3 continuation, while a new BO1 remains isolated from the completed capture.
- Raw completion no longer depends on normal replay/video capture or the match's `keepReplay` choice.
- A raw-only completion atomically writes the JSON payload plus an adjacent `*.riftlite-index.json` manifest before retiring the in-memory session. It does not create a `ReplayRecord`, so it cannot appear in the normal video replay library. If a `ReplayRecord` becomes available later, the service associates the matching manifest by capture, series, match, replay, then room identity.
- During an active Atlas match, each retained frame is also appended to a bounded per-session `*.riftlite-active.jsonl` recovery journal through one persistent file handle. BO3 provisional-session merges replace that journal with one atomic checkpoint. After an unexpected desktop exit, complete JSONL rows are validated and promoted to the normal raw JSON plus index manifest; a truncated final row is ignored, the recovered capture is shown in the upload queue with an incomplete-capture warning, and capture-time account consent is preserved. Normal finalization writes the durable artifact and index before closing and deleting the journal, so recovery cannot replace or duplicate a completed capture.

## First-party upload

The first-party client uses the authenticated Replay V2 protocol:

1. gzip the exact local JSON and calculate its SHA-256 and byte length;
2. `POST /api/v2/replays/init` with the deterministic capture ID and declared digest/length;
3. when requested, `PUT` the binary gzip body to the returned same-origin endpoint;
4. `POST` the returned completion endpoint;
5. persist the processing state and canonical `/replays/:id` player URL in the adjacent manifest and, when present, the associated `ReplayRecord`.

Init, upload, and completion calls have bounded deadlines and retry transient failures. The deterministic capture ID plus checksum makes retry safe. Redirects and non-`https://www.riftlite.com` response origins are rejected. RiftLite persists the returned replay ID and same-origin status endpoint immediately after init, then reconciles interrupted or stale processing through the authenticated owner status route. HTTP 425 and `replay_processing` are active, retryable states rather than saved failures; server `Retry-After`/`retryAfterMs` controls the next check.

First-party upload requires a linked account UID that exactly matches both the opt-in account and the Secure Token response, rechecks that identity before each protocol step, enforces the website's 4 MiB gzip limit without retrying oversize captures, and reconciles an existing deterministic replay to the currently requested visibility. Capture-time consent is pinned to the explicitly opted-in account even if a later health check temporarily fails; authentication health controls when the queued upload can run, not whether the already-consented capture is eligible. Visibility defaults to private. The separate RiftReplay API-key uploader has independent legacy consent and does not participate in the V2 protocol.

Every persisted capture carries a durable delivery stage, attempt count, next retry, structured server error code/class, and partial warnings. Network calls cannot hold the global queue indefinitely, foreground retries requested during an automatic pass run in a following forced pass, and mutations of the same capture are serialized so a late failure cannot overwrite success. The desktop Web Replays page is the primary setup and recovery centre: it shows Atlas and TCGA opt-ins, visibility, live upload activity, account recovery, Retry, Upload anyway, Keep local only, latest replay, Discord sharing, and collapsed technical details. Account and Settings link to this centre rather than hiding separate recovery workflows.

When the server reports only `replay_capture_missing_mulligan`, RiftLite retries completion with `{ "allowIncomplete": true }`. The published replay stays watchable and visibly warns that its opening mulligan was not captured. Every other capture-quality failure remains blocked and keeps the raw source locally.

## Embedded player security and authentication

The hidden replay webview has a dedicated `persist:riftlite-replay` partition. Main-process handling identifies that partition before game-webview setup, so it never receives Atlas/TCGA debugger or capture taps. It accepts top-level navigation only to the exact RiftLite HTTPS origin under `/replays`, denies popups and all unrelated permissions, and sends unexpected HTTP(S) navigation to the system browser. Exact replay main-frame content receives only the video display-capture, sanitized clipboard-write, and fullscreen permissions needed by the player controls; display capture is bound to that same webview frame and never grants audio/camera access.

Private embedded playback uses the server-side authentication bootstrap:

1. the main process refreshes the linked Firebase account token;
2. using the dedicated Electron session, it sends that token only in the `Authorization` header of `POST /api/v2/replay-embed-session`;
3. the website verifies it and sets a short-lived `Secure`, `HttpOnly`, `SameSite=Lax` session cookie in the dedicated replay partition;
4. the main process verifies that the cookie was stored, then loads or reloads `/replays/:id?embed=1`.

The partition's cookies are cleared at application startup, before every bootstrap, when account identity settings change, when a link completes, and when the account is unlinked. An auth generation and post-refresh identity checks prevent an in-flight old-account bootstrap from restoring credentials or retaining its cookie after an account switch. When no linked account exists or bootstrap fails, cookies are cleared and the same URL loads without authentication, limiting playback to public or unlisted access. The Firebase token never enters renderer state, URLs, local storage, or webview JavaScript.
