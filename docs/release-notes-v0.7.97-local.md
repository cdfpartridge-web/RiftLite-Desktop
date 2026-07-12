# RiftLite Beta 0.7.97 (Local Build)

This local tester build adds opt-in private-hub Discord sharing for RiftLite Web Replay.

## Unlisted replay links

- **Private** remains owner-only.
- **Unlisted** is watchable by anyone with the permanent link but is excluded from public replay listings.
- Discord-shared replays are automatically secured as Unlisted.

## Private-hub Discord feed

- Select joined private hubs under **Account → Replay and account connection**.
- Enable **Share completed replay links to private-hub Discord** before starting the match.
- RiftLite posts player names, legend matchup, BO1/BO3 score, and replay link to each selected hub's configured bot `feed_channel`.
- Replay ownership and current hub membership are verified by the website before posting.
- Raw capture data, chat, room codes, account IDs, and diagnostics are never posted.
- Existing replays are not automatically backfilled, and disabling/unlinking/switching revokes consent.
- Delivery claims and Discord nonce enforcement prevent duplicate feed messages during retries.

The required website support is live on `https://www.riftlite.com`. This Windows installer was built locally only and was not uploaded to GitHub.
