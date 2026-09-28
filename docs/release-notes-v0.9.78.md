# RiftLite Beta v0.9.78 — Atlas history improvements

- **Fewer background requests to Rift Atlas.** History checks are shared across matches and stop once they pass the relevant game date.
- **No repeated lookups for completed or private decks.** Saved results are retained while RiftLite waits for any missing games in a best-of-three match.
- **Unrecorded games stop retrying.** Automatic checks use longer delays and a limited number of attempts, with a 24-hour cutoff that also applies after restarting RiftLite.
- **Manual refresh stays available.** Choose Get Atlas decks or Refresh in match details for an older or missing list. Opening match details no longer triggers another lookup by itself.

Existing profiles, matches, decks, replays and settings are retained. Available for Windows, Mac Intel and Mac Apple Silicon.

macOS installers remain ad-hoc signed and are not Apple-notarized.
