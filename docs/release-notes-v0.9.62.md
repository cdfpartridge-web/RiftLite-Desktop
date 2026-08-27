# RiftLite Beta v0.9.62

RiftLite v0.9.62 restores the missing RiftAtlas game-start controls reported after RiftAtlas's latest interface update.

## RiftAtlas lobby fix

- Fixes the RiftAtlas lobby sometimes showing decks, adverts, and page chrome while hiding **Find Random Match**, **Host Room**, **Solo Room**, and **Join / Spectate**.
- Adds an embedded-browser compatibility fix for RiftAtlas's updated responsive layout on Windows and macOS.
- Applies the fix early during loading and again after navigation, covering fresh launches, sign-in returns, and slower page loads.
- Preserves RiftAtlas's responsive desktop layout rather than forcing a fixed-size or simplified lobby.

## Recovery improvements

- Sign-in and OAuth pages no longer count as proof that missing lobby controls recovered.
- Automatic repair remains bounded and will only reset its recovery state after the real lobby controls are visible.
- Match recording, local decks, captures, settings, and account data are unchanged.

## Installation notes

- Updating preserves existing matches, decks, captures, settings, and account connections.
- Windows may show a SmartScreen warning because the installer is not yet Authenticode signed.
- Separate macOS builds are provided for Apple silicon and Intel. They are ad-hoc signed and not notarised, so first launch may require Control-clicking RiftLite and choosing **Open**, or approving it in **Privacy & Security**.
