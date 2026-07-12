# RiftLite Changelog - Changes Since 0.7.80

This covers the customer-facing desktop and hosted website changes developed after 0.7.80 through RiftLite 0.8.00. RiftLite now includes account-linked Atlas web replays, full BO3 playback with animated sideboarding, safer account setup and cloud sync, stronger replay tools, improved match capture, and expanded private-hub and Discord support.

## Major New Features

### RiftLite Web Replay

Completed RiftAtlas matches can now be rebuilt as interactive web replays and attached to your RiftLite account.

- Automatic Atlas replay upload is available as an account-linked opt-in.
- Replays can be watched inside the new **RiftLite web replay** tab or through RiftLite.com.
- The player recreates the board, hand, runes, battlefields, scores, card movement, champion play, tokens, counters, labels, attachments, choices, and match log.
- Opening sequences now include matchup, battlefield, initiative, mulligan, and starting-hand scenes.
- Mulligans animate cards leaving the hand and their replacements arriving.
- Deck-inspection effects show the cards viewed, the card selected, and its destination in one stable scene.
- Token artwork is supported for common generated cards including Recruit, Mech, Gold, Bird, Sand Soldier, and Sprite.
- Card hover and inspection tools provide a larger card view, including cards in trash and other browsable zones.
- Playback controls include pause, seeking, fixed jumps, keyboard shortcuts, and faster playback speeds.

Replays are **Private** by default. They can also be changed to **Unlisted**, meaning anyone with the link can watch but the replay is not listed publicly, or **Public** for discovery on the replay page.

### Full BO3 Web Replay And Animated Sideboarding

RiftLite Web Replay now treats an Atlas best-of-three as one complete series.

- Games stay together even when Atlas changes rooms between games.
- Game 2 and Game 3 have their own setup, battlefield, mulligan, and first-player sequences.
- Between-game scenes show the series score and game number.
- Sideboard cards moved Out and In are shown with card art, quantities, and animations.
- Opponent sideboarding remains hidden unless a future replay contains both players' agreed perspectives.
- Seeking backwards rebuilds the selected game immediately without replaying every earlier animation.

### Simpler RiftLite Accounts

Account setup has been redesigned to make signing up, linking the desktop, and joining private hubs much clearer.

- Local-only, linking, profile-completion, connected, and reconnect states are now clearly separated.
- Google and email sign-in use the same guided setup.
- Players choose a proper display name and unique handle instead of being left with a generated `Player#...` identity.
- The website shows the exact account being linked before the desktop connection is confirmed.
- Hub invites, Discord verification, Find Match, and team actions continue automatically after account setup is completed.
- The Account page now shows connection health, the linked identity, replay destination, and safe reconnect, repair, and account-switch actions.
- Existing local matches, replays, hub roles, Discord links, and cloud data are retained when repairing or linking an older account.

### Private-Hub Discord Replay Sharing

Testing groups can now receive RiftLite Web Replay links through their existing private-hub Discord bot.

- Players choose which joined private hubs may receive future replay links.
- Shared replays are automatically set to **Unlisted**.
- Discord reports include the player matchup, legend matchup, BO1/BO3 score, and permanent replay link.
- Existing uploaded replays can be shared manually with a confirmation step.
- Hub IDs are displayed in RiftLite and on the website so similarly named hubs can be distinguished.
- Duplicate delivery protection prevents the same replay being posted repeatedly during retries.

Raw capture data, room codes, chat, account IDs, and diagnostics are never included in the Discord post.

### Account Cloud Sync Beta

Linked accounts can now back up RiftLite data for recovery or use on another device.

- Match history, decks, prep data, settings, and other structured app data can be backed up.
- Existing cloud backups are detected before local data is uploaded.
- Restore, keep-local, and cancel choices protect a useful backup from being replaced accidentally.
- Interrupted uploads are protected so an incomplete backup cannot silently become the current backup.
- Cloud restore creates a local safety copy and rolls back if the imported data is invalid.

Large replay video files are intentionally kept local and are not included in account cloud sync.

### Improved Video Replays, Clips, And Coaching Tools

Local video replay and review tools have received a substantial quality pass.

- MP4 export is more reliable, including recordings created in WebM/VP8 format.
- Presentation-mode audio and replay audio controls have been corrected.
- Original match audio can be muted during export when required.
- Playback now supports faster review speeds including 2x, 4x, and 6x.
- Fullscreen controls include timeline navigation and back/forward jumps.
- Coaching flags, timestamps, drawings, audio notes, and presentation recordings are easier to review and export.
- Shadowplay-style rolling clips can save a recent moment without stopping the main replay.
- A live review hotkey can mark an important moment while the match is still being recorded.

### Vendetta Preview Support

RiftLite now understands the Vendetta Preview as its own season layer.

- Preview legends and battlefields are recognised across capture, match history, filters, matchup tools, and community statistics.
- Akali, Kennen, and other newer legend detection has been improved across TCGA and RiftAtlas.
- Vendetta Preview data can be viewed separately from the archived pre-Vendetta meta.
- Older matches remain available instead of being mixed into the new season.

### Community, Matchup, And Deck Improvements

- Matchup Lab has clearer navigation and more visual matchup results.
- Matchups can be filtered by your legend and linked back to supporting matches and replay evidence.
- Deck comparison shows more complete shared, missing, and changed card lists.
- Community deck and matrix pages use improved cached data for faster loading.
- Matchup Prep supports visual mulligan, sideboard, battlefield, priority-card, and matchup-note guides.
- Tracker and prep overlays are more compact, movable, and less likely to interfere with game controls or chat.
- BO3 opponent information is retained more consistently between games.

### Social, Private Hubs, And LFG

- Private-hub and team onboarding is easier to follow.
- RiftLite.com now includes dedicated **Account** and **My Hubs** pages.
- Exact hub IDs can be copied for Discord bot setup.
- Discord account verification and private-hub roles use the player's current RiftLite identity.
- LFG posting, accepting, closing, and Discord voice-room handling have been improved.
- Testing-group bot support includes verification, recent matches, leaderboards, goals, announcements, and reports.

### Replay Library Improvements

- Replay libraries are ordered by match time rather than upload time.
- The website and embedded library support player legend, opponent legend, player/opponent search, BO1/BO3, result, status, and visibility filters.
- Replays can be sorted by newest, oldest, player legend, or opponent legend.
- Replay cards now show the matchup information needed to find the right game quickly.

## Important Fixes And Reliability Improvements

### Match Capture

- Fixed Atlas BO3 reviews appearing during sideboarding or between games.
- Improved BO1 and BO3 completion timing and duplicate-review protection.
- Consecutive BO3 games with identical scores are no longer incorrectly merged into one game.
- Room changes, delayed match finalisation, and missing match-end room codes are handled more reliably.
- Raw replay captures remain associated with the correct match instead of whichever match finishes last.
- Duplicate Atlas WebSocket frames are centrally filtered to prevent repeated actions and inflated captures.
- Battlefield ownership, score retention, winner detection, and newer legend detection have received multiple fixes.

### Web Replay Playback

- Fixed incorrect battlefield placement for units and duplicated cards.
- Fixed battlefields appearing vertically in card previews.
- Fixed champion-zone cards remaining visible after being played.
- Added clearer point displays and improved card sizing and hand layout.
- Added visible labels, counter values, duplicate indicators, and equipped-card stacking.
- Fixed BO3 battlefield information carrying into the next game before new battlefields were selected.
- Removed flickers between opening scenes and during multi-step deck inspection.
- Improved missing token art, card previews, hover inspection, and card text clarity.

### Accounts And Data Safety

- Account linking can no longer silently use a different browser account.
- Reconnect and account switching are now separate, explicit actions.
- Automatic replay upload is blocked if the desktop and website identities do not agree.
- Enabling account sync no longer overwrites an existing cloud backup without confirmation.
- Cloud backups use safer generation-based uploads and integrity checks.
- Cloud restores are protected by a safety backup and transactional rollback.
- Local database recovery has been improved for damaged or incomplete files.

### Replay Recording And Export

- Improved replay-to-match attachment for delayed and back-to-back games.
- Improved recovery for missing or partially written replay media.
- Fixed several MP4 export paths that could produce corrupt or unusable files.
- Improved longer recording and high-quality export handling.
- Fixed replay volume, mute, fullscreen, timeline, and presentation-audio behaviour.

### Interface And Navigation

- The main navigation is clearer and easier to scan.
- Home now highlights recent captures, decks, prep, community tools, Discord, featured content, and support links.
- Incomplete experimental tools have been removed from normal navigation until they are ready.
- Empty or disconnected embedded pages now show useful recovery guidance instead of appearing as a blank screen.

## Quick Guide To The New Features

### 1. Create Or Link A RiftLite Account

1. Open **Account** in RiftLite.
2. Choose **Connect account**.
3. Complete Google or email sign-in in the browser.
4. Choose your display name and unique handle if prompted.
5. Confirm the exact account shown on the linking page.
6. Return to RiftLite and wait for the Account page to show **Connected**.

If RiftLite shows a reconnect warning, use **Verify/Repair connection**. Use **Switch account safely** only when you intentionally want a different account.

### 2. Enable Automatic Atlas Web Replays

1. Link your RiftLite account first.
2. Open **Settings**.
3. Enable **Automatically upload Atlas replays**.
4. Play and complete a RiftAtlas match normally.
5. Open **RiftLite web replay** from the left navigation.
6. Select the new replay from **My replays**.

Uploads are Private by default. Change a replay to Unlisted when you want to share its link without listing it publicly.

### 3. Watch A BO3 And Its Sideboard Changes

1. Start the match as BO3 in RiftAtlas and keep RiftLite running throughout the series.
2. Complete sideboarding normally between games.
3. After the series ends, open the uploaded web replay.
4. Watch through the Game 1 result to reach the sideboard and Game 2 setup scenes.
5. Use the timeline or game navigation to jump between games.

Your recorded Out/In choices are shown visually. Opponent choices remain hidden unless both perspectives are deliberately combined in a future team-testing workflow.

### 4. Share Future Replays To A Private-Hub Discord

1. Join the private hub and link the same RiftLite account in the desktop app.
2. Open **Account** and find the replay-sharing section.
3. Select the private hub or hubs that should receive future replay reports.
4. Complete a new Atlas match.

The replay uploads as Unlisted and is posted to the hub's configured Discord reports channel. A hub administrator must configure the bot's reports channel first.

To share an existing uploaded replay, open its replay details and choose **Share to Discord**. RiftLite will ask before changing a Private replay to Unlisted.

### 5. Use Account Cloud Sync

1. Open **Account** and enable account cloud sync.
2. If RiftLite finds an existing cloud backup, review the Restore, Keep Local, or Cancel choices carefully.
3. On a second device, link the same account and choose Restore when prompted.

Do not expect local replay videos to move between devices; those remain on the computer where they were recorded.

### 6. Use Faster Review, Clips, And Flags

1. Open **Replays** and select a local video replay.
2. Use the speed control for 2x, 4x, or 6x review.
3. Use flags, drawings, or audio notes to mark coaching moments.
4. Configure the rolling-clip and live-review hotkeys in Settings.
5. Export the full replay or a selected clip when finished.

### 7. Join A Private Hub And Verify Discord

1. Complete your RiftLite account profile.
2. Open the hub invite link or visit **My Hubs** on RiftLite.com.
3. Join the hub and confirm it appears in the desktop Account area.
4. Run `/verify` in the hub's Discord server.
5. Open the verification link and approve the same RiftLite account.

Hub owners can copy the exact Hub ID from **My Hubs** or the private-hub details screen when configuring the Discord bot.

## Notes

- RiftLite Web Replay currently supports RiftAtlas capture.
- Automatic web replay upload, cloud sync, and Discord replay sharing are opt-in.
- Private replays remain owner-only. Unlisted replays are accessible to anyone with the permanent link but do not appear in the public library.
- Existing local matches, decks, prep notes, and replay files are retained when updating from an older 0.7 build.
