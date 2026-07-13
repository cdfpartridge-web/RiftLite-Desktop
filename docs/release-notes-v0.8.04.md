# RiftLite Beta v0.8.04

## Private hubs are easier to run

- Hub owners can appoint trusted members as **Co-owners**.
- Co-owners can help with invites, member moderation, testing goals, and approved Discord commands while the original owner remains in control.
- A new **Hub Health** view brings the linked RiftLite account, exact hub ID, Discord setup, verification, latest web replay, and delivery status together in one place.

## Clearer Discord verification

- Discord administrators can use `/verified` to see which server members have successfully linked RiftLite accounts.
- The list uses current RiftLite names and handles without exposing email addresses or internal account IDs.
- Hub and Discord permissions now follow one consistent role model, reducing confusing permission errors.

## More reliable replay reporting

- Automatic Discord sharing now attaches to the real Atlas match start instead of an earlier lobby connection.
- A replay is shared only to hubs selected when the match starts and still selected when it finishes.
- RiftLite waits for the completed match result before uploading a Discord-bound replay, avoiding premature **Score Pending** posts.
- Interrupted uploads and Discord posts retain their progress and retry safely without duplicating successful messages.
- Replay details show capture, result, website processing, and Discord delivery stages so problems are easier to understand.

## Safer hub access

- Private-hub permissions and website database rules have been tightened and tested together.
- Members retain normal access while ownership, co-owner, moderation, invite, and Discord actions are checked consistently.

## Existing data

This is an in-place update. Existing RiftLite accounts, settings, matches, decks, private hubs, cloud backups, and replay data remain intact.
