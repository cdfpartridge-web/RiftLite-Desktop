# TCGA Web Replay monitor

## Purpose

TCGA and RiftAtlas expose match state differently. RiftAtlas replay capture must remain unchanged; the TCGA monitor is a temporary, provider-specific observation path used to learn how TCGA game messages map to RiftLite's existing Web Replay model.

The monitor starts disabled on every app launch and never uploads its files. It records only after the user presses **Start monitor**.

## What it records

- Raw inbound and outbound payloads on TCGA's PeerJS/WebRTC data channel labelled `game`.
- Channel and peer lifecycle events, timestamps, and ordering metadata.
- Relevant request, response, signalling, WebSocket, and EventSource evidence visible through Chromium's debugging protocol.
- Structured board checkpoints from the TCGA page: visible cards, zones, logs, dialogs, controls, and geometry.
- Click, drag-start, and drop checkpoints to correlate a user action with the surrounding protocol messages.

The capture preserves card, match, player, action, and sequence identifiers needed for replay analysis. It removes authentication values, cookies and headers, URL query strings/fragments, and machine-local paths. Input, textarea, and editable-field values are not captured.

## Capture workflow

1. Open **Settings → Privacy, support & updates → Show advanced → Capture Lab**.
2. Press **Start monitor** before opening or joining a TCGA match.
3. Open TCGA and play the test games below. The live counters should show **Game messages** and **Board checks** increasing.
4. Return to Capture Lab and press **Stop and save**.
5. RiftLite opens the output location. Keep the `.jsonl.gz` capture plus its `.summary.json` and `.analysis.json` companions together. **Stop and save** also creates one `.web-replay.json.gz` source companion per decoded game channel and lists each path in Capture Lab.
6. Check that the Capture Lab reports **Decoder: usable**, **Timeline: complete**, zero incomplete chunks, and no reached limit. The research gzip and Web Replay source companions are sensitive local evidence; neither is uploaded automatically.

If **Game messages** remains at zero during a match, stop and keep the file anyway: the channel/DOM/network evidence will show where the hook diverged from the current TCGA implementation.

## Representative games

Aim for two or three games rather than repeating the same line:

1. A normal game with a mulligan, draws, unit and non-unit cards, movement, combat, scoring, several end-turn transitions, and a normal game end.
2. A game with a different first player plus a concede or other early finish.
3. If available, a best-of-three flow covering game rollover and sideboarding.

Useful extra cases are tokens, face-down or hidden information, temporary effects, stack/response ordering, card reveal/search, and any unusual pause or choice dialog.

## Output and limits

Captures are stored under the app's user-data directory in `TCGA Replay Monitor`. Use **Open folder** rather than relying on a fixed Windows path.

Each session stops automatically after two hours, 50,000 records, or 128 MiB of captured record data. Raw game-channel messages are preserved exactly; lower-frequency DOM checkpoints provide visual correlation without repeating the full board every five seconds. At most three completed exports are retained for up to seven days. Retention and **Delete captures** also remove their generated Web Replay companions by the parent capture stem. They remove only files owned by this monitor; they do not touch matches, decks, videos, accounts, or Atlas Web Replays.

When a capture is saved, RiftLite also creates a privacy-safe `.analysis.json` companion. It reports BinaryPack decoding, PeerJS chunk completeness, state/action coverage, and whether the captured replay timeline appears complete. It contains aggregate counts only, not decoded cards, decks, names, player IDs, room IDs, or raw payloads. Keep using one monitor session per test match while the TCGA adapter is under development.

## Decoder and Web Replay adapter state

RiftLite now decodes and reassembles the captured PeerJS BinaryPack frames locally. The analysis companion checks full-state, history, turn, stack, reveal and terminal coverage without copying decoded private data into the report. The decoded messages remain sensitive transport evidence, not the final replay format.

The Akali-versus-Irelia follow-up capture produced a clean second game channel and now validates the first isolated TCGA adapter end to end. The desktop exporter segments channels and writes `riftlite-tcga-raw-capture` version 1. The website's TCGA-only normalizer merges full player state, projects privacy before serialization, and emits the existing `riftlite-canonical-replay` version 2 consumed by the unchanged Web Replay player.

The real local fixture contains 478 events, 19 sparse deterministic checkpoints, setup phases from matchup through gameplay, and a turn-13 final board. It deliberately has no result because the capture ended at 7-7 without authoritative winner evidence. Opponent hand, deck, rune deck, sideboard, hidden exile, and uncertain-zone identities are emitted only as identity-free placeholders. Grouped children inherit the host's live zone while attached, and positional TCGA card-counter values are projected into the replay counter badges at the captured times.

This is still a local validation path. TCGA source companions are not connected to desktop automatic upload, Discord sharing, or production deployment. The website accepts the TCGA schema through a provider dispatcher; Atlas continues through its original parser and normalizer and cannot fall through to the TCGA path. A localhost-only fixture route is enabled only outside production with `RIFTLITE_LOCAL_TCGA_REPLAY_DIR`.

Do not route TCGA data through the Atlas raw-capture service or weaken Atlas validation to accept TCGA frames.
