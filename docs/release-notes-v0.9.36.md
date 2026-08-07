# RiftLite Beta v0.9.36

RiftLite v0.9.36 improves RiftAtlas startup recovery and makes captured-match saving and deletion more dependable.

## What's fixed

- RiftAtlas recovery now handles empty or stalled pages more reliably and will no longer leave the game hidden indefinitely.
- If automatic Atlas recovery cannot restore the lobby, RiftLite offers a clearer embedded sign-in reset while preserving Atlas-local decks and all RiftLite data.
- Atlas connection diagnostics can now identify when a network filter or security gateway returns a placeholder page instead of the real application.
- Rare local database runtime faults now recover automatically instead of causing every later Match Review save or deletion to fail.
- **Delete capture** remains available when the review's first local write did not complete or linked replay metadata is damaged.
- A completed deletion is no longer shown as failed just because Match History could not refresh immediately.
- Completed Web Replay warnings can now be cleared from **Upload activity** without deleting the local capture or online replay.

Existing local matches, decks, recordings, accounts, and replay files remain intact when updating.
