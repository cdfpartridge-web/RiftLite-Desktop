# RiftLite Beta v0.9.42

RiftLite v0.9.42 brings live community broadcasts to Home and makes frame-by-frame Web Replays much easier to watch on a full display.

## Live on Home

- A remotely controlled Twitch takeover can replace the creator-video carousel while the configured channel is live.
- The stream starts automatically and muted. Twitch's own controls remain available for sound, pause, quality, and fullscreen.
- You can hide the live stream for the rest of the current RiftLite session; the normal YouTube carousel returns immediately.
- The takeover only activates after Twitch confirms the exact configured channel is live. Turning it off in Meta Studio restores the normal Home experience without a desktop update.

## Better Web Replay fullscreen

- Web Replays now have a labelled desktop fullscreen mode that keeps the selected replay and exact frame loaded.
- The frame-by-frame player also has its own clearly labelled player-only fullscreen control.
- Press `F` to enter or exit player fullscreen and `Esc` to leave it.
- Fullscreen button labels stay in sync with the actual player state, including browser and Electron embeds.

## Privacy and reliability

- Opening Stacked Deck and similar Atlas card popovers no longer creates a false incomplete match review.
- Review later now closes as soon as the pending match is stored safely; replay finalization and upload work continue in the background instead of holding the modal open.
- Live status uses a small dedicated endpoint so it can change promptly without repeatedly rebuilding the full Home creator feed.
- The Twitch player is isolated in a non-persistent session and is loaded only for a confirmed live takeover.
- Privacy and cookie information now explains the automatic muted Twitch connection.
