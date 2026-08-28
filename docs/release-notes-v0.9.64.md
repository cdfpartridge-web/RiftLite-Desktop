# RiftLite Beta v0.9.64

RiftLite v0.9.64 fixes the recurring RiftAtlas lobby and sign-in problem that could force players to reset all Atlas site data after reopening the app.

## RiftAtlas lobby recovery

- First refreshes an expired room token without signing the player out or clearing Atlas site data.
- Returns a rejected or stale room session to RiftAtlas's safe lobby automatically.
- Preserves the player's Atlas login, local decks, player name, preferences, and legitimate pending actions during normal recovery.
- If Atlas rejects a freshly minted token again, resets only the Atlas sign-in and asks the player to sign in once; local decks, preferences, and site data remain intact.
- Detects stale active-room state before RiftAtlas starts, preventing a blank lobby or missing Play buttons after a restart.
- Keeps Atlas's normal Resume and Take over room recovery available.

## Safer repairs

- Stops and closes the old embedded Atlas page before an explicit repair, preventing it from writing stale state back during cleanup.
- Reserves sign-in-cookie removal for a confirmed Clerk sign-in failure or a second consecutive room-token rejection instead of using it for the first error.
- Keeps every RiftLite account, match, capture, deck, replay, and setting unchanged.

## Compatibility checks

- Verified the live RiftAtlas lobby across 1024×768, 1280×720, 1366×768, and 1920×1080 layouts at standard and high-DPI scaling.
- Verified cold starts, close-and-reopen cycles, runtime repair, sign-in repair, and full-reset recovery paths.

## Installation notes

- Updating preserves existing RiftLite and RiftAtlas data.
- Windows may show a SmartScreen warning because the installer is not yet Authenticode signed.
- Separate macOS builds are provided for Apple silicon and Intel. They are ad-hoc signed and not notarised, so first launch may require Control-clicking RiftLite and choosing **Open**, or approving it in **Privacy & Security**.
