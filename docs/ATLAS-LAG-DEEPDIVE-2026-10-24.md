# Atlas lag deep dive — 24 October 2026

Status: local investigation and fixes; the underlying cause of the observed connection stalls is **not yet established**. Public v0.9.86 is unchanged. Do not describe these changes as a verified cure for the ten-second pauses.

**User follow-up:** The user subsequently reported “Ok no lag” after testing the new local installer. Record this as one smooth normal-app game, without attributing it to one individual change or declaring every lag condition solved. They then requested publication of the missing All cards website update; that separate website deployment completed as recorded in the current START_HERE entry.

## What the incident establishes

The retained video-off game began at 18:19:06 UTC, about 35 minutes after app startup. Five actions took 10.4–10.8 seconds to acknowledge. Atlas's public client starts a liveness probe two seconds after an unacknowledged action, waits another eight seconds, then replaces the socket and resends. All five acknowledgements followed replacement. Other actions were normally fast (median 34 ms), and all 279 observed actions eventually acknowledged.

Eight early match sockets stopped producing observed inbound frames 18–24 seconds after creation. Replacement sockets resumed quickly, while the account socket remained responsive. Later match sockets stayed healthy for roughly nine and thirteen minutes. PartySocket reports its close before native shutdown finishes, so overlapping socket lifetimes alone are not evidence of two active player sessions.

The early six-minute window has no main-process watchdog stall, no in-game navigation and no reported resource failure. Its two slow database saves took 78 and 107 ms. Guest timer and long-task summaries show subsecond work, not a ten-second renderer freeze. Replay upload/history import occurred after the game. Video and timed screenshots were off. These observations weaken video recording, startup warming, automatic cache repair and ordinary JavaScript CPU work as explanations for this incident.

The 20-second cutoff remains unexplained. Atlas's idle heartbeat resets on inbound traffic, so its own 20-second idle interval does not explain an incoming cutoff while traffic is flowing. Observed token expiry was several minutes away, outside the public client's renewal/last-five-seconds action-queue paths. Exact Chromium 142 source excludes WebSocket requests from QUIC alternative-service jobs; disabling QUIC or resetting caches would be speculative.

## Controls and measured application work

The user reported three smooth real-game controls: plain Electron; Electron plus the default CDP observer; and an embedded webview with the released production preload and observer. They used the same isolated diagnostic profile, which now contains real user sign-in and must not be copied, reset or automatically launched. The third control had debug mode enabled but discarded its capture events rather than running the full application backend.

The additional offline full-renderer fixture uses the actual built App, app/game preloads, an intercepted Atlas HTTPS origin, local WebSocket echoes and a new synthetic profile. The baseline delivered 2,799/2,799 echoes with maximum RTT 14.8 ms and no long tasks, remounts or visibility changes, even with roughly 743 synthetic capture/health updates. That exceeds normal boundary-event cadence. Backend APIs were mocked; this is not a test of real Atlas transport or the full backend combined with the renderer.

The final after-change fixture used debug mode, 40 owned cards and 120 changing log rows: 2,800/2,800 echoes, maximum RTT 5.1 ms, no long tasks or socket errors. Disabled tracker calls fell from 789 state plus 789 vision-status requests to zero. The changed workload means the RTT difference must not be presented as a controlled speed improvement.

A separate backend benchmark replayed the recorded workload's sizes using inert synthetic bytes: 2,986 frames, 747 coordinator events, a 51.2 MB database and replay-library diagnostics. It did not reproduce a ten-second stall. Warm diagnostics nevertheless reread 810 manifest files per request (214–252 ms); ten concurrent requests reread 8,100 files and took about 2.24 seconds before coalescing. After coalescing, ten concurrent requests read 810 files once, taking 242 ms. The final burst retained all 2,986 frames, with maximum loopback echo RTT 8.3 ms and timer delay 37.5 ms. Its synthetic output directory was also under the OneDrive workspace. Filesystem timing does not measure OneDrive background upload traffic or prove that cloud sync was harmless.

**Correction to the prior audit:** the custom replay-directory setting was empty. The effective default was under OneDrive/Documents/RiftLite/Replay Bundles, so live interactive journals still wrote into OneDrive even with video disabled. The prior collector checked only the empty custom value when reporting an outside-OneDrive boolean. The original evidence file is retained; that boolean is not reliable.

A final read-only check of the affected capture found no journal-write diagnostic, restart-recovery boundary or manifest error; the 361 retained event rows in the early six-minute window had no matching failure. Thus there is no affirmative evidence that the recovery retry defect actually triggered during this incident. Historical recovery failures lived in transient `lastAssociationError`, so absence in retained logs is not a complete exclusion.

## Local changes

- Disabled deck tracking performs no state/status polling. Enabled requests coalesce while a read is in flight; disabling, changing context and teardown retire obsolete responses.
- Concurrent replay upload-diagnostics requests share one scan for the current settings snapshot. Later polls remain fresh and account/settings changes do not reuse another account's result.
- The Atlas CDP observer retains no HTTP response bodies or POST data. It only needs WebSocket events. An earlier exact-Electron synthetic benchmark showed approximately 32 MiB of unnecessary retained memory under a 32 MiB HTTP load; zero buffers preserved all WebSocket frames. This reduces overhead but did not reproduce or solve the transport failure in that benchmark.
- Active interactive journals use `userData/Raw Capture Staging`, while completed replay bundles keep the selected destination. Recovery scans the staging and legacy locations and preserves conflicting copies. Merged sources are removed only after the complete raw file and manifest are saved, and only with compatible capture-time ownership/share consent. If staging fails, all retained frames are checkpointed into the selected replay folder with a visible warning; if both locations fail, capture remains in memory and retries a full checkpoint. Sixteen new durability cases passed, including restart, missing destination, disk-write failure, duplicate/provisional/authoritative copies and account changes. Failed recovery scans have a 30-second backoff for status/finish calls; repeated incoming frames cannot retry a failed scan under unchanged settings. Changed settings permit a new attempt. This bounds recovery work; it does not promise zero recovery I/O during a game.
- Passive socket diagnostics correlate CDP timestamps with main-process receipt time and sampled event-loop drift. They retain only bounded numeric timing/count fields, no tokens, headers, player/room identifiers or extra payload copies. Canonical replay timestamps remain unchanged.

The new timestamp boundary is specifically **Blink → CDP → main process**. Chromium stamps a WebSocket frame when Blink observes it; this is not a wire timestamp. Small observer delay during a future stall would rule against a backed-up inspector/main queue, but would not identify whether the server, network, Chromium network service or delivery into Blink was responsible. A real Electron localhost check used genuine CDP clock fields: a deliberate 325 ms main-thread block produced 292 ms maximum observer delay, then returned to zero. This verifies the measurement, not the incident's cause.

## Evidence and next discriminant

Evidence paths are relative to the active desktop worktree:

- `output/atlas-video-off-20261024/transport-correlation.json`: action/probe/replacement timings, current Atlas public bundle URLs/hashes and exact Chromium 142 primary-source links.
- `output/atlas-video-off-20261024/renderer-network-correlations.json` and `latest-session.json`: existing sanitized incident evidence.
- `output/atlas-video-off-20261024/capture-audit/cdp-buffer-findings.json`: native/default/zero-buffer comparison.
- `output/atlas-video-off-20261024/observer-timing/verification.json`: genuine Electron clock and deliberate-block verification.
- `output/atlas-fullapp-lag-20261024/`: synthetic renderer fixtures.
- `output/atlas-async-pipeline-20261024/findings.json` and `before.json`: backend workload and diagnostics coalescing benchmark; the preliminary baseline had a teardown socket reset, which the clean final run corrected.
- `output/atlas-async-pipeline-20261024/staging-validation.json` and `incident-journal-check.json`: durability tests, storage correction and incident error-code check.

The remaining major uncontrolled differences are the normal profile/session and real transport conditions, plus the complete backend/renderer workload together. Offline fixtures cannot establish an external connection failure's cause. A real normal-app game with the candidate is the next meaningful check; if it pauses, compare the new source/observer timings and main-loop sample with the heartbeat sequence. Do not request many more individual-layer games or describe another successful synthetic echo test as proof of a live fix.

No real user profile was launched or modified for these changes. No sign-in, gameplay action, profile migration, installation, version bump, commit, tag movement, push or deployment was performed.

## Final source validation

The final frozen product sources passed **3,039 tests across 264 files**, TypeScript, and **82 account checks**. The first full pass had 3,037 tests; the suite was rerun after adding the two final retry regressions. Independent review found and corrected enabled-tracker refresh starvation, provisional/authoritative journal selection, source-journal ownership guards and per-frame recovery retries. Focused tests cover the corrected cases.

The local package gate records product-source hashes in `output/installer-atlas-lag-deepdive-20261024/gate-evidence.json`; packaging rejects source changes after that gate. The candidate remains version 0.9.86. It includes the existing local automatic Atlas All cards collection, whose website endpoint/player changes remain separately unpublished.

The local installer is complete at `output/installer-atlas-lag-deepdive-20261024/RiftLiteBetaInstall.exe` (159,779,460 bytes; SHA256 `c3744ad3d5e11ae7f8fd39fab9a9cdc2f1cad17d861ff2d8765557df4c000a85`). Production build, Windows artifact verification, isolated packaged startup, full compiled/resource parity, and explicit lag/automatic-postgame module checks passed. Product sources, Git refs, earlier installers and the website's original `next-env.d.ts` bytes were preserved. See `build-evidence.json`, `lag-package-verification.json` and `automatic-postgame-package-verification.json` beside the installer. It has not been installed or published, and a normal real-game lag retest has not been performed by the agent.
