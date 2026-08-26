# RiftLite Beta v0.9.61

RiftLite v0.9.61 is a focused RiftAtlas loading and recovery hotfix.

## RiftAtlas loading recovery

- RiftLite now detects the partial Atlas page where adverts, event rails, and footer links load but the real lobby and play controls are missing.
- Lobby monitoring continues after Atlas initially appears healthy, so a broken return from a match can still be recognised and repaired.
- Recovery waits through active recording and the post-match continuation window before retrying, preventing it from interrupting a live game or best-of-three series.
- Automatic recovery is restricted to the Atlas lobby and sign-in surfaces. Deck tools and active match routes are never redirected by the lobby health check.
- If Atlas recovers by itself or the user navigates elsewhere, the pending reload is cancelled. A committed repair remains limited to one safe attempt, preventing reload loops.

## Data safety

- Automatic recovery refreshes only disposable Atlas runtime caches.
- Atlas sign-in, cookies, local storage, local decks, RiftLite matches, captures, settings, and account connections are preserved.
- Insights remains a Coming Soon preview while normal match and replay evidence capture continues in the background.

## Installation notes

- Updating preserves existing matches, decks, captures, settings, and account connections.
- Windows may show a SmartScreen warning because the installer is not yet Authenticode signed.
- Separate macOS builds are provided for Apple silicon and Intel. They are ad-hoc signed and not notarised, so first launch may require Control-clicking RiftLite and choosing **Open**, or approving it in **Privacy & Security**.
