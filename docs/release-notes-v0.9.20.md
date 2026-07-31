# RiftLite Beta v0.9.20

RiftLite v0.9.20 brings a more reliable RiftAtlas session, better replay exports, and a new memory aid for cards legitimately revealed from an opponent's hand.

## Known opponent hand

- RiftAtlas hand reveals can now populate an in-memory panel with the real card art.
- Exact cards disappear automatically when authoritative game data proves that they left the hand.
- Cards can also be dismissed manually, including duplicate copies as separate instances.
- Use the eye button in the Play toolbar or press `F12` to open the panel.
- The panel is cleared at game and room boundaries and is never saved or uploaded.

## RiftAtlas reliability

- Room changes are treated as clean match boundaries, preventing missing games in consecutive sessions.
- Finalized-result echoes no longer create ghost `Unknown` matches after a BO3 review.
- Empty Atlas application shells now repair their disposable runtime cache before reloading, while preserving sign-in, decks, and RiftLite data.
- The startup cover includes **Repair now** and **Show Atlas now** escape hatches.

## Replay MP4 annotations

- MP4 exports now burn selected flags, notes, and drawings into the finished video on Windows.
- An overlay rendering problem now stops the export with a visible error instead of silently returning a clean video.

## Private hubs

- Hub owners can remove members and co-owners.
- Co-owners can remove regular members, with the website continuing to enforce the final permission checks.

All existing accounts, settings, matches, decks, replay associations, captures, and media locations remain unchanged.
