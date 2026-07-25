# RiftLite Beta v0.9.12

RiftLite v0.9.12 fixes an intermittent RiftAtlas input problem inside the desktop app.

## RiftAtlas input reliability

- RiftAtlas text fields now recover native keyboard focus when clicked.
- Focus is restored when returning to the Play view or reactivating RiftLite.
- Recovery is paused while a RiftLite dialog or control owns focus, preventing unwanted focus stealing.
- Focus requests are throttled and restricted to the trusted RiftAtlas webview.

All existing accounts, settings, matches, capture data, Web Replays, and Discord reporting remain unchanged.
