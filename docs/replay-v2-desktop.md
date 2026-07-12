# Replay V2 desktop integration

RiftLite Web Replay is user-facing. Atlas capture and first-party upload remain off until the user explicitly enables **Automatically upload Atlas replays** in Settings while a RiftLite account is linked. The old local reconstructed Replay Lab and third-party RiftReplay credentials remain separate from this first-party flow.

## User-facing behaviour

- The Settings opt-in enables Atlas raw capture and first-party automatic upload together.
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

## First-party upload

The first-party client uses the authenticated Replay V2 protocol:

1. gzip the exact local JSON and calculate its SHA-256 and byte length;
2. `POST /api/v2/replays/init` with the deterministic capture ID and declared digest/length;
3. when requested, `PUT` the binary gzip body to the returned same-origin endpoint;
4. `POST` the returned completion endpoint;
5. persist the processing state and canonical `/replays/:id` player URL in the adjacent manifest and, when present, the associated `ReplayRecord`.

Init, upload, and completion calls retry transient failures. The deterministic capture ID plus checksum makes retry safe. Redirects and non-`https://www.riftlite.com` response origins are rejected. First-party upload requires a linked account UID that exactly matches both the opt-in account and the Secure Token response, rechecks that identity before each protocol step, enforces the website's 4 MiB gzip limit without retrying oversize captures, and reconciles an existing deterministic replay to the currently requested visibility. Visibility defaults to private. The separate RiftReplay API-key uploader has independent legacy consent and does not participate in the V2 protocol.

## Embedded player security and authentication

The hidden replay webview has a dedicated `persist:riftlite-replay` partition. Main-process handling identifies that partition before game-webview setup, so it never receives Atlas/TCGA debugger or capture taps. It accepts top-level navigation only to the exact RiftLite HTTPS origin under `/replays`, denies popups and all unrelated permissions, and sends unexpected HTTP(S) navigation to the system browser. Exact replay main-frame content receives only the video display-capture, sanitized clipboard-write, and fullscreen permissions needed by the player controls; display capture is bound to that same webview frame and never grants audio/camera access.

Private embedded playback uses the server-side authentication bootstrap:

1. the main process refreshes the linked Firebase account token;
2. using the dedicated Electron session, it sends that token only in the `Authorization` header of `POST /api/v2/replay-embed-session`;
3. the website verifies it and sets a short-lived `Secure`, `HttpOnly`, `SameSite=Lax` session cookie in the dedicated replay partition;
4. the main process verifies that the cookie was stored, then loads or reloads `/replays/:id?embed=1`.

The partition's cookies are cleared at application startup, before every bootstrap, when account identity settings change, when a link completes, and when the account is unlinked. An auth generation and post-refresh identity checks prevent an in-flight old-account bootstrap from restoring credentials or retaining its cookie after an account switch. When no linked account exists or bootstrap fails, cookies are cleared and the same URL loads without authentication, limiting playback to public or unlisted access. The Firebase token never enters renderer state, URLs, local storage, or webview JavaScript.
