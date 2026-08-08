# RiftLite Beta v0.9.40

RiftLite v0.9.40 brings the most useful deck, replay, and play tools directly onto Home, adds Frodan to Featured Creators, and prevents unusually large TCGA Web Replay captures from blocking match reporting.

## What's new

- Home now leads with your most recently played saved deck, official card artwork, record, win rate, recent form, and a direct route into its performance view.
- **My decks**, **Community decks**, and **View my replays** are now prominent Home destinations.
- **Play now** lets you choose Atlas or TCGA as your persistent default. Starting a game follows that choice while preserving the existing active-capture and pending-review safety checks.
- Frodan is the second Featured Creator, with an official profile, YouTube, Twitch, and X links. Two weighted Frodan video spots are included in the YouTube carousel.

## What's fixed

- Repeated TCGA player-state snapshots are compacted without changing replay semantics, keeping long Web Replay captures within the existing upload limits more reliably.
- If a valid TCGA Web Replay artifact is still too large, RiftLite now skips that optional replay artifact and records bounded diagnostics instead of trapping **Save match** or **Review later** in a retry loop.
- Default-platform settings are normalized across upgrades, survive restarts, and recover to the persisted value if a save fails.

Existing local matches, decks, recordings, accounts, and replay files remain intact when updating. Skipping an oversized optional Web Replay artifact does not discard the saved match result.
