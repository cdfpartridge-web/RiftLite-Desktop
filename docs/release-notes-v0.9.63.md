# RiftLite Beta v0.9.63

RiftLite v0.9.63 fixes a RiftAtlas sign-in failure that could prevent a match from starting and leave the lobby controls missing after a repair.

## RiftAtlas session recovery

- Detects RiftAtlas's `invalid_claims` signed-in-session error when it appears in the lobby.
- Safely resets only the invalid embedded RiftAtlas sign-in cookies, then opens RiftAtlas's sign-in page so the user can reconnect.
- Keeps RiftLite account data, matches, decks, captures, replays, and settings unchanged.
- Avoids interrupting an active Atlas capture if the error appears during a match.

## Lobby reliability

- Retries the RiftAtlas lobby compatibility style if Chromium rejects its first insertion during a page load.
- Cancels delayed style retries when the page navigates, preventing an old document from affecting a replacement lobby.
- Ignores delayed shell-ready messages from a webview that has already been replaced during repair.

## Installation notes

- Updating preserves existing matches, decks, captures, settings, and account connections.
- Windows may show a SmartScreen warning because the installer is not yet Authenticode signed.
- Separate macOS builds are provided for Apple silicon and Intel. They are ad-hoc signed and not notarised, so first launch may require Control-clicking RiftLite and choosing **Open**, or approving it in **Privacy & Security**.
