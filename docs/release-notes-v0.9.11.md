# RiftLite Beta v0.9.11

RiftLite v0.9.11 is a reliability release focused on accounts, match reporting, Web Replays, Discord delivery, and smoother day-to-day use.

## TCGA Web Replays

- TCGA games can now be captured, normalized, uploaded, and played through the same Web Replay library used by RiftAtlas.
- Battlefield placement follows TCGA's owner-relative lane data, including cards controlled by either player.
- Opponent points, counters, grouped/equipped cards, card movement, opening hands, mulligans, turns, and card ordering are represented more accurately.
- TCGA BO1 results use the confirmed Match Review outcome as the authority while preserving captured Riftbound points on the game board.

## Match reporting and Discord

- TCGA Match Review saves locally first, so the confirmation popup closes quickly while replay processing, cloud sync, and Discord delivery continue safely in the background.
- Discord posting waits for the confirmed Match Review result instead of guessing the winner from the board state when a player concedes.
- Failed or interrupted replay and Discord delivery can resume from the durable local queue.
- Public, private-hub, and team match updates use stronger ownership and account checks.

## Accounts and syncing

- Linked-account identity is pinned throughout uploads, restores, and background sync work so account changes cannot redirect an in-flight operation.
- Discord account recovery is available again alongside Google and email linking.
- Cloud restore and two-device conflict handling reject stale or ambiguous writes while preserving newer local changes.
- Legacy identities and private hubs are claimed only through verified account aliases.

## RiftAtlas and app reliability

- Match Review no longer opens at the start of an Atlas game.
- Atlas chat focus is restored after a game and the embedded Atlas page has stronger blank-page recovery.
- Background vision processing is removed from normal live tracking now that authoritative event data is available.
- Repeated high-cost work is reduced, and event-loop diagnostics help identify future stalls without interrupting gameplay.
- Update installation, macOS window activation, and packaged-app startup handling are more reliable.

## Replays and community

- Public Web Replays can load beyond the first 48 entries.
- Battlefield ownership, grouped attachments, counters, opening hands, and older replay compatibility have additional regression coverage.
- MaskedSwan and Arg0nTCG have been added to the featured creator rotation.

This is an in-place update. Existing accounts, settings, matches, decks, private hubs, cloud backups, and replay data remain intact. Local video files remain on the computer where they were recorded and are not copied through account sync.
