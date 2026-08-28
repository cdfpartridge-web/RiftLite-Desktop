# RiftLite Beta v0.9.65

RiftLite v0.9.65 is an urgent RiftAtlas match-entry safety update. It fixes a case where Atlas's normal matchmaking transition could be mistaken for a broken lobby and trigger repair while a game was opening.

## Match-entry protection

- Recognises RiftAtlas matchmaking `start` and `searching` traffic before match recording becomes active.
- Protects matchmaking, room, play, and game routes from every automatic repair action.
- Keeps that protection active even if Atlas briefly redraws its lobby controls while a queue is running.
- Rechecks the current Atlas guest, route, navigation, and capture state immediately before any automatic retry.
- Cancels a queued recovery if Atlas starts entering a game or replaces the embedded page.

## Non-destructive lobby recovery

- The early empty-lobby check is now diagnostic only and cannot start repair.
- A retry is considered only after Atlas has remained genuinely incomplete for at least 60 seconds.
- Automatic recovery performs at most one cache-busted lobby navigation. It does not clear caches, service workers, cookies, local storage, IndexedDB, or network connections.
- RiftLite keeps the live Atlas page visible while evaluating recovery, so a matchmaking transition cannot be covered by a repair screen.
- Atlas load or renderer failures now ask for attention instead of automatically remounting the page during the pre-match gap.

## Safer sign-in handling

- Removes the proactive token-cache refresh that previously ran on every Atlas root-page load.
- A confirmed `invalid_claims` message can refresh only the in-memory session token while Atlas is safely idle; it cannot redirect, restart the guest, or clear Atlas data.
- A repeated rejection now offers the targeted **Reset Atlas sign-in** action instead of automatically resetting the session.
- Manual repair is blocked while Atlas is matchmaking, entering a game, recording, or awaiting match review.

## Compatibility checks

- Reproduced the reported lobby-to-game timing from production diagnostics and added a deterministic regression test for it.
- Verified the current live RiftAtlas lobby at 1024×768, 1280×720, 1366×768, and 1920×1080 with all four play controls visible and no horizontal overflow.
- Updating preserves all RiftLite account data, matches, captures, decks, replays, settings, and Atlas-local decks.
