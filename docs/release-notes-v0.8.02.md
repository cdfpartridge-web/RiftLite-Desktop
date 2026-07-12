# RiftLite Beta v0.8.02

## RiftAtlas black-screen recovery

- RiftLite now detects when the embedded RiftAtlas browser repeatedly reloads without reaching a match.
- A new **Repair Atlas** action clears only Atlas's embedded cache and service worker, then reloads the page.
- Atlas cookies, account storage, RiftLite settings, matches, decks, and replays are preserved.
- Additional embedded-browser diagnostics capture navigation, load, preload, console, renderer, and responsiveness failures for support exports.

## Capture improvements

- RiftAtlas authoritative first-player choices now populate **Went 1st** or **Went 2nd** automatically for each game in a BO3 review.
- Automatic Discord replay reports wait for the local match result to finalize before uploading, reducing premature **Score Pending** posts.

## Existing data

This is an in-place update. Existing RiftLite accounts, settings, matches, decks, private hubs, and replay data remain intact.
