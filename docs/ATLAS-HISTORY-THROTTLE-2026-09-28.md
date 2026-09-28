# Atlas history request reduction — 28 September 2026

Status: local desktop source fix, pending release. Public desktop remains v0.9.77.

Atlas's developer reported roughly 400,000 RiftLite history calls daily. The code confirmed that each automatic match refresh independently traversed up to five 20-game pages, that the timer ran every 30 seconds, and that unresolved matches retried indefinitely with a maximum five-minute backoff. The reported daily total was not independently measured.

## Changes

- Each automatic pass sends up to three match IDs to one shared history traversal. Deck responses are reused within that pass when records reference the same provider game.
- Pagination stops after the page that passes the oldest required game start date. Every row on that page is checked, preserving duplicate-match detection. Raw timestamps include solo and unfinished rows; malformed timestamps or observed ordering violations disable the date shortcut. The five-page ceiling and cursor-loop protection remain.
- Completed game attachments are skipped during automatic imports. An explicit private opponent deck is a completed result, including when a different BO3 game is still missing. The owner's deck remains accessible even when the owner enabled privacy in Atlas.
- Passes are at least two minutes apart. The background timer checks once per minute; match-list reads and save triggers use the same throttled scheduler.
- Normal retries stop after eight attempts per app session. Gaps are 2, 5, 15, 30, 60, 120 and 240 minutes. Corrected names, scores or provider game markers can prompt another attempt, up to ten total attempts per session. Imported history, privacy results, notes and `updatedAt` do not reset these limits.
- Automatic lookups stop 24 hours after the latest valid capture/game timestamp. This age cutoff survives relaunch; the in-memory attempt counters do not. A small provider clock skew is tolerated. Later BO3 game markers can keep a genuinely recent game eligible.
- Manual **Get/Refresh Atlas decks** remains available after the automatic limits and can explicitly refresh completed/private attachments.
- Opening/reopening the match deck panel no longer calls the manual endpoint automatically. Background history updates still appear; only the explicit button bypasses the automatic retry policy.

Exact provider timestamp, game number, both player names and both scores are still required. Ambiguous matches receive no deck reads. A missing match does not block another valid match in the batch. One Atlas session ID is required throughout all history/deck requests, and all remote reads finish before any match is saved. Same-match manual and automatic requests coalesce.

## Delivery and evidence

This code runs inside the desktop app and calls Atlas directly through the embedded signed-in game. A RiftLite website deployment cannot reduce requests made by older installed desktop versions. No Atlas API calls, account mutations, installer builds, version changes or publication were performed for this fix.

Validation uses synthetic fixtures and mocked Atlas responses. All **234 test files / 2,619 tests** passed, including batching, date boundaries, ambiguous entries, private results, BO3 partial results, session switching, retry exhaustion, restarts and shared-export privacy. Both TypeScript projects passed (`npm run lint` and `npx tsc -p tsconfig.electron.json --noEmit`); changed-code whitespace checks passed. No authenticated live Atlas import was performed.

Evidence: `output/atlas-history-throttle-20260928/` contains `tests.log`, `typecheck-electron.log`, `typecheck-renderer.log` and the read-only pre-edit snapshot `handover-before.txt`.

Existing uncommitted documentation, Android work and other local files are preserved.
