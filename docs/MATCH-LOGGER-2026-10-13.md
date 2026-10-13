# Atlas match logger reopening — 13 October 2026

Local source fix based on desktop HEAD `62f4fcf11c5517ac495027c081f7b219957b8a02`, version 0.9.83. The published v0.9.83 installers do not contain this fix. No rebuild, installation, version change, push or publication was performed.

## Confirmed cause

The user reported a fresh Match logger appearing when starting another Atlas game after saving the previous one. Read-only inspection of bounded capture diagnostics confirmed two occurrences on October 13:

- A three-game match was published at 20:09:34 UTC after returning to the lobby. At 20:12:02, Atlas emitted another active start for the same room, opponent and final 7–6 score. The next opponent's start caused a duplicate one-game review at 20:12:04.
- A terminal 4–2 match was published at 20:18:30 UTC. Twelve seconds later its finished board emitted a result-free start, followed by an inactive end. Starting the next game caused another one-game review at 20:19:30.

The capture preload resets its active flag after an end. When Atlas removes the result dialog but retains the board, the resulting start signal is not evidence of a genuinely new game. The coordinator previously cleared its completed-match marker on any result-free start and recreated the old capture. Existing result-dialog suppression did not cover the finished board after the dialog disappeared; its two-minute expiry also missed the first occurrence above.

## Changes

- Remember the finished game's point pair and available game/history identity when publishing a review. Ignore result-free active boards matching the known completed room, opponent and points, including delayed boards beyond the loose result-dialog timeout.
- Permit new captures when the room, opponent, game/history identity or points change, including same-room score resets and snapshot-only rematches. Keep manual partial reviews and ongoing BO3 child games capturable.
- Cover ordinary BO1 victory snapshots as well as terminal BO3 screens, so an immediate result snapshot cannot recreate the capture before the dialog closes.
- In the renderer, cancel pending automatic review lookups on a new game or save/defer/delete. Validate the request generation and capture health after IPC returns, before changing history or opening a modal. Explicit review opening remains available.

The finished-board check requires known matching room, opponent and a complete point pair. Missing evidence remains capturable. A completely missed rematch presenting exactly the same room, opponent and points with no changed game/history identity is ambiguous until another state change supplies evidence.

## Validation

- TypeScript passed (`npm run lint`).
- Full suite: **250 files, 2,838 tests passed**.
- Added 11 capture regressions, including both observed sequences with synthetic identities and their original relative delays, and 10 renderer regressions executing the actual callbacks with delayed IPC.
- Coverage includes real same-room rematches, snapshot-only score resets, changed game/history identity, missed starts, BO3 continuation, BO1 victory snapshots and manual partial review continuation.
- Independent review completed with no remaining actionable findings; `git diff --check` passed.

Evidence: `output/match-logger-popup-20261013/diagnostic-summary.json` contains timestamps and non-identifying state facts; `full-tests.log` records the full-suite result. Existing user data, dirty documentation, website files and release artifacts were preserved. No live game acceptance test or new installer was performed.
