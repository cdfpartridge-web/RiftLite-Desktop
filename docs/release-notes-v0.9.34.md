# RiftLite Beta v0.9.34

RiftLite v0.9.34 focuses on protecting local recordings and making account and Web Replay recovery more dependable.

## What's improved

- Completed Atlas and TCGA captures are retained locally when account verification, upload delivery, or match reporting is temporarily unavailable.
- Interrupted Atlas capture journals can recover into visible local Web Replays instead of silently disappearing.
- RiftLite retries pending reviewed match reports and Web Replay delivery together after startup and temporary failures.
- Local database and secure-account storage recovery is more resilient after interrupted writes or rare runtime memory errors.
- Older local-only accounts can now upgrade to a real RiftLite account without an incorrect Account ID mismatch or losing their local setup.

Existing local matches, decks, recordings, and replay files remain intact when updating.
