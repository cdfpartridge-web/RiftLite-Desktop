# RiftLite Beta v0.9.37

RiftLite v0.9.37 fixes premature and repeated Match Review prompts during RiftAtlas best-of-three matches, and strengthens recovery from a rare local database failure.

## What's fixed

- RiftAtlas room codes are no longer mistaken for opponent names when a best-of-three advances to a new game room.
- Game 1 remains attached to the active best-of-three instead of being incorrectly offered as a completed Bo1 match.
- Room transitions no longer cause repeated incomplete-match review prompts during later games in the same series.
- A local database runtime error that could block **Save match**, **Review later**, **Delete capture**, and closing the review now triggers a bounded reopen-and-retry recovery.
- If the database retry still cannot complete, Match Review now explains that the local database runtime stopped responding and recommends restarting RiftLite before retrying.

Existing local matches, decks, recordings, accounts, and replay files remain intact when updating. Matches that were already split incorrectly before this update are not merged automatically.
