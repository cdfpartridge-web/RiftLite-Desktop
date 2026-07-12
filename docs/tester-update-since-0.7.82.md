# RiftLite Tester Update - Changes Since 0.7.82

This update covers the main tester-facing changes added after 0.7.82, up to the current 0.7.95 build.

## v0.7.95 BO3 web replay and animated sideboarding

- Atlas BO3 games now remain together in one RiftLite Web Replay across room changes.
- Between-game playback shows exact capture-player sideboard cards Out and In, including quantities and card art.
- Opponent sideboard choices remain hidden behind a generic locked-in state.
- Game transitions show the BO3 game number and available series score.
- Game 2/3 setup follows the phases Atlas actually recorded, including first-player selection without a fake initiative roll.
- New captures carry a privacy-safe result summary so missing web-replay winners and points can be restored.
- Already-uploaded raw replay artifacts remain immutable.

## v0.7.94 account and private-hub onboarding

- Account setup now clearly separates local-only, linking, profile completion, ready, and reconnect states.
- Anonymous background Firebase sessions are no longer presented as linked RiftLite accounts.
- Google/email setup, display name, and handle completion now form one guided flow.
- Private-hub invites, Discord verification, Find Match, and team tools resume automatically after account setup.
- RiftLite.com now includes Account and My Hubs pages with exact hub IDs and Open in RiftLite links.
- Existing accounts, local matches, hub roles, replay ownership, Discord links, and cloud backups are retained when desktop and website UIDs differ.
- Generated Player names and email addresses are no longer accepted as completed social identities.

## Biggest Additions

### Vendetta Preview Season Support

RiftLite now has a proper Vendetta Preview season layer.

- New Vendetta preview legends are recognised in match capture, search, filters, matchup tools, and community stats.
- Recent fixes include Akali detection on both TCGA and RiftAtlas.
- New preview battlefields and preview-season metadata have been added.
- Community views can separate Vendetta Preview data from the older pre-Vendetta meta.
- Pre-Vendetta data remains available as an archive instead of being mixed into the new season.

Please test new legends, new battlefields, and preview decks on both TCGA and RiftAtlas.

### Account Cloud Sync Beta

Linked accounts now have an opt-in cloud sync system for moving local data between devices.

- Users can enable account sync from the Account page.
- Sync is designed for local app data such as match history, deck/prep data, and settings.
- Replay video files are not synced, to avoid huge uploads and storage costs.
- Sync is batched and chunked so it should not upload after every single click.
- A restore option is available for setting up a second device.

This is intended to make reinstalling or moving PC much less scary, while keeping large replay media local.

### RiftLite Web Replay

Atlas raw captures can now be uploaded automatically to the linked RiftLite account when the user explicitly opts in from Settings.

- The **RiftLite web replay** tab opens the account's private replay library inside the desktop app.
- Completed Atlas uploads are account-owned and private by default.
- v0.7.91 repairs authentication for desktop accounts that began as anonymous Firebase sessions before Google/email was linked.
- If the account session needs attention, the tab now shows Public replays, reconnect guidance, and a direct Account action instead of an empty-looking screen.
- v0.7.93 repairs automatic upload when Atlas WebSocket capture knows the room code but the match-end page omits it; unique strict time-window matches attach, while ambiguous or stale captures remain rejected.
- Web replays now animate exact mulligan exchanges and load Atlas token artwork such as Recruit, Mech, Gold, Bird, Sand Soldier, and Sprite.

Please test opening the web replay tab, watching the uploaded replay, and completing a new opted-in Atlas match.

### Replay Tools And Export Improvements

Replay tools have had a lot of quality-of-life work.

- MP4 export is more reliable, including WebM/VP8 recordings that previously failed when converting to MP4.
- Replay volume controls now affect replay audio properly.
- Export options include muting original recording audio where needed.
- Replay playback speed controls now include faster review speeds such as 2x, 4x, and 6x.
- Replay controls have been moved and cleaned up so the video is easier to access.
- Fullscreen replay controls now include timeline movement and back/forward controls.
- Replay flag/timestamp workflows have been improved for coaching and review.

Please test full replay export, clip export, audio/mute options, and faster playback.

### Shadow Clips And Review Hotkeys

RiftLite now has Shadowplay-style replay support for testers who want quick clips.

- A rolling replay buffer can be used while the main replay continues recording.
- Users can save a short separate clip with a hotkey.
- A second hotkey can add a review flag to the current live replay.
- These are configured in the replay/settings area.

This is useful for quickly marking a key turn or saving a short moment without stopping the main match recording.

### Deck Tracker And Opponent Tracker Polish

The tracker work has been tightened up.

- The deck helper is more compact and movable.
- The prep widget no longer auto-opens at game start.
- The prep widget should interfere less with chat/input areas.
- Opponent tracker support has improved, including card images where available.
- The opponent view now focuses more on what has been seen and what may still matter.
- BO3 opponent information is retained better across games, so repeated games in a match are easier to review.

Please test this especially in BO3s where sideboarding changes what is likely to appear.

### Community And Matchup Lab Improvements

Community data tools have been made easier to use and more visual.

- Matchup Lab has a clearer sidebar entry.
- The visual matchup board can be filtered by your legend.
- Matchup board entries can link back toward the relevant matches.
- Deck comparison tools now show more complete card differences instead of cutting off lists early.
- Community deck views and matrix views continue to use cached data to reduce backend load.

Please check that community pages still load quickly and that filters feel correct.

### Social, LFG, Teams, And Discord Improvements

The social tooling has had several fixes and groundwork additions.

- LFG posting and active listing display have been cleaned up.
- Discord voice room handling has been improved for LFG listings.
- Close warnings now explain when closing a listing may also close the Discord voice room.
- Private hub/team invite permission issues have been worked on.
- Discord bot / verified testing group groundwork has been added behind the scenes for future testing communities.

Please test private hub invites, team invites, LFG posting, accepting listings, and Discord voice creation.

### Home Page And Content Polish

The home page has been cleaned up so useful features are easier to find.

- The left navigation is clearer than the old icon-only rail.
- Home now highlights play, community decks, recent capture, prep, Discord, featured content, and support routes.
- Featured creator and stream widgets have been adjusted.
- The Metafy support area has been made more visible.
- Some in-progress replay-lab experiments are hidden from the main app while they are still being polished.

## Important Fixes

### Match Capture

- Fixed several Atlas BO3 cases where RiftLite could pop up between games or miss a game.
- Improved handling of sideboarding and between-game states.
- Improved final review timing so BO1 and BO3 behave more consistently.
- Added stronger protections against duplicate popups after a match is already submitted.
- Improved new legend detection for both TCGA and RiftAtlas.
- Improved battlefield and score retention in some multi-game edge cases.

Please keep reporting logs for any BO3 that still misses a game or opens a popup at the wrong time.

### Replay Recording And Missing Media

- Improved replay attachment so recordings are less likely to attach to the wrong match.
- Improved handling for longer games and larger YouTube-ready recordings.
- Added more recovery paths for missing or partial replay media.
- Fixed several export paths that could produce corrupted or unusable MP4 files.

Please test longer games, YouTube-ready mode, and back-to-back games.

### Data Safety

- Added safer handling for local database corruption reports.
- RiftLite now has more recovery logic around malformed local database files.
- The goal is to avoid users losing everything if the local database file becomes damaged.

If a tester sees database errors, please ask them not to delete anything before sending logs/screenshots.

### Account And Update Flow

- Account sync has been added as an opt-in recovery/migration route.
- Update metadata has been checked against the current 0.7.95 installer.
- The Windows installer metadata now points at 0.7.95.
- The app continues to use the RiftLite Beta 0.7 installer naming.

### Replay Review UX

- Replay speed controls added.
- Replay audio controls improved.
- Replay export errors should be clearer.
- Flag/timestamp export and coaching workflows have had polish.
- Fullscreen replay controls have had several layout fixes.

### Decks And Prep

- Prep card image handling has been improved.
- Prep widgets are less intrusive by default.
- Deck comparison views show larger/more complete missing/shared card lists.
- Community deck duplicate/card-art grouping has been improved.

## Tester Focus Areas

Please prioritise testing:

1. TCGA and RiftAtlas games using Vendetta preview legends, especially Akali.
2. Atlas BO3s with sideboarding and 2-1 finishes.
3. Back-to-back BO1s and BO3s without returning to lobby.
4. Longer replay recordings in YouTube-ready mode.
5. MP4 export, clip export, audio mute, and faster playback.
6. Account cloud sync on a second device or clean install.
7. Private hub/team invites and LFG Discord voice flow.
8. Community season filters and Matchup Lab visual filters.

## Current Build Check

Current Windows release metadata:

- Version: 0.7.95
- Installer: `RiftLiteBetaInstall.exe`
- Product name: `RiftLite Beta 0.7`
