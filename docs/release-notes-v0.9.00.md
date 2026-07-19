# RiftLite Beta v0.9.00

RiftLite 0.9 is our biggest update yet: a complete visual refresh, a much simpler account experience, stronger replay and match tracking, and a long list of reliability improvements shaped by tester feedback.

## A completely refreshed RiftLite

- Every main area has been redesigned with a cleaner, more modern interface.
- The sidebar still collapses, and the Play toolbar now resizes with it.
- Review, Prepare, and Community tools are grouped into clearer menus without removing existing features.
- Settings are organised into expandable sections so it is easier to find what you need.
- The force-stop-match control is now always visible on the Play screen.
- New users receive a guided tour that continues through their first successfully saved match.
- The Home dashboard keeps its partnership space, active deck, Riftlab feature, and rotating community spotlight.

## Simpler accounts and more confident syncing

- Link RiftLite using the same Google or email account you use on the website.
- Existing accounts, match history, decks, active-deck choices, and private hubs are carried forward.
- Account Sync now shows local and cloud totals, the last successful sync, active-deck status, and migration progress.
- Before choosing local or cloud data, RiftLite shows a preview of what will be applied.
- Older account records and legacy private hubs are repaired and claimed more reliably.
- Cloud restore and two-device conflict handling have been strengthened and are now part of the release test gate.

## Better Play and Atlas reliability

- RiftAtlas blank or empty pages now recover automatically without clearing your sign-in.
- Google sign-in remains inside RiftLite's protected Atlas session, fixing the previous `authorization_invalid` loop.
- Atlas rendering and viewport handling have been improved for sharper cards across different monitor sizes.
- Match popups scroll correctly again.
- Local game video capture now uses the correct embedded-frame identity and falls back to cropped window capture if direct recording is unavailable.
- Replay delivery status updates live after upload and processing instead of remaining stuck on an earlier pending state.

## Stronger match tracking and replays

- Current battlefields, legends, signed cards, overnumbered cards, runes, and alternate artwork map back to their correct gameplay identities.
- Match tracking, deck recognition, and replay presentation share the expanded card registry.
- Missing or moved local replay media can be reattached more reliably, including on macOS.
- A completed RiftLite Web Replay is clearly distinguished from optional local video or screenshots.
- Web Replays now support 1×, 2×, 4×, 6×, and 10× playback.
- Replay controls, scrolling, overlays, card presentation, and private replay access have received additional fixes.

## Private hubs and Discord

- Members and co-owners can leave a private hub.
- Primary owners can delete a hub through a deliberate confirmation and countdown.
- Private-hub match details can open the attached Web Replay without making it public.
- Legacy hubs remain visible while ownership is being claimed instead of disappearing prematurely.
- When the detected legend matches your active deck, Discord reports include its Piltover deck link rather than posting the full deck list.

## Community and performance

- Community spotlight cards open the creator's RiftLite page and retain their creator-themed artwork.
- Partnership messaging is clearer and less intrusive.
- Repeated community, account-link, hub-replay, and website data requests are cached or coalesced to reduce unnecessary background reads.
- Replay uploads and account operations recover more safely from interruptions.

## Security and privacy

- Account refresh tokens and integration secrets now use Windows or macOS secure storage.
- New manual and cloud backups omit secrets by default.
- Diagnostic bundles redact names, email addresses, room codes, tokens, local paths, and raw payloads unless a sensitive export is explicitly approved.
- Embedded browser navigation, popups, permissions, IPC messages, and trusted origins are validated more tightly.

## Existing data

This is an in-place update. Existing RiftLite accounts, settings, matches, decks, private hubs, cloud backups, and replay data remain intact.

Local video files remain on the computer where they were recorded and are not copied through account sync. Windows builds are currently unsigned, so Microsoft SmartScreen may display its usual warning during installation.
