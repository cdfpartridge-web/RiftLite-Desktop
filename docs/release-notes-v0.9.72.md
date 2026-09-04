# RiftLite Beta v0.9.72 — Atlas compatibility hotfix

RiftLite v0.9.72 focuses on tester-reported interaction problems in the embedded RiftAtlas lobby and a Matches-page layout issue.

## Atlas lobby interaction recovery

- **Player name field recovery.** If RiftAtlas loads its Player name field at zero size, RiftLite now detects that specific collapsed layout and restores the existing field without reading or changing its value.
- **More reliable typing and controls.** Trusted pointer, focus, and keyboard interaction now reinforces the embedded Atlas guest's native focus. Atlas also receives a throttled repaint request when interaction suggests Chromium has stopped presenting the guest correctly.
- **Find Match and Host Room protection.** The recovery targets the cases where visible controls appeared enabled but did nothing, while retaining the existing safeguards around matchmaking, room entry, capture, and review.
- **No destructive automatic recovery.** Interaction recovery does not reload Atlas, clear site data, sign the player out, change the Player name, or start a match.
- **Quieter recovery reporting.** A passive Atlas font `ERR_CACHE_MISS` immediately after successful runtime recovery is no longer shown as the latest embedded failure. Detailed local diagnostics remain available, and important page, script, network, authentication, or unrelated failures remain visible.

## Matches layout

- **Stable sizing while scrolling.** The Matches page no longer grows wider as more saved rows are rendered during scrolling.
- **Responsive actions.** Replay, Edit, and Delete remain accessible across the supported desktop widths without pushing the page beyond its available space.

## Good to know

- Updating preserves the existing RiftLite profile, matches, decks, replays, settings, media paths, and `riftlite:` links.
- Search Rules remains hidden while its implementation is held for a later release.
- Replay Coach remains Coming Soon; Deck Insights remains available.
- macOS installers are ad-hoc signed and not Apple-notarized, so macOS may show its standard first-open warning.
