# RiftLite Beta v0.9.41

RiftLite v0.9.41 makes local replays easier to find and removes the old size ceiling that prevented long recordings from being exported.

## What's new

- Replay details now include **Show in folder**, taking you directly to the best available local replay file: the recorded video, raw Web Replay capture, imported `.riftreplay` pack, or captured frame.
- Local Web Replays also include a dedicated **Show source file** action.

## What's fixed

- MP4 and clip exports no longer inherit the old 384 MiB source-video limit. RiftLite streams these exports through FFmpeg instead of rejecting longer recordings up front.
- Long-running video exports now receive a duration-aware processing window rather than a fixed timeout.
- Streamed `.riftreplay` coaching packs can now contain up to 8 GiB of video and 12 GiB in total, while retaining strict limits for manifests, encoded lines, and legacy whole-file imports.
- Large local videos are streamed from disk for playback and export instead of being copied through renderer IPC memory.
- File-reveal requests are checked against RiftLite-managed storage, expected file types, and resolved filesystem paths before Finder or Explorer is opened.

Existing matches, decks, recordings, imported replay packs, accounts, and settings remain intact when updating.
