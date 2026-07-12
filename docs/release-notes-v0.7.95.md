# RiftLite Beta 0.7.95

This release adds complete best-of-three support to RiftLite Web Replay, including animated sideboard changes between games.

## BO3 web replay

- Multi-game Atlas captures remain together as one BO3 replay across room changes.
- Game 2 and Game 3 transitions show the BO3 game number and available series score.
- The replay follows the setup phases Atlas actually recorded instead of inventing missing steps.
- A first-player selection without an initiative roll is shown without fake dice.
- Seeking backwards reconstructs the selected game immediately without replaying forward animations.

## Animated sideboarding

- Cards moved out of the capture player's deck are shown with card art, quantities, and an animated exit.
- Cards brought in are shown with card art, quantities, and an animated entrance.
- Card matching uses the stable card code first and a normalized name fallback when necessary.
- Opponent sideboard choices remain private and appear only as a generic locked-in state.

## Results and upload reliability

- Completed Atlas uploads include a minimal perspective-relative match summary so the website can restore BO3 game winners and points when WebSocket gameplay has no explicit terminal result.
- The uploaded summary excludes player names, account IDs, room IDs, battlefield labels, chat, notes, deck lists, and raw match evidence.
- Result metadata still reaches the web replay when local video replay capture is disabled.
- Already-uploaded raw artifacts remain immutable so their capture identity and checksum cannot be invalidated later.

All account, private-hub, replay-upload, mulligan, token-art, cloud-sync integrity, and Atlas deduplication improvements from v0.7.94 remain included.
