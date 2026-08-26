# RiftLite Beta v0.9.60

RiftLite v0.9.60 focuses on match-capture reliability, safer replay exports, and a smoother review and training experience. The Insights section now shows a Coming Soon preview while its next, more visual coaching experience is being refined; matches and replay evidence continue to be captured normally in the background.

## RiftAtlas capture reliability

- Match tracking now uses RiftAtlas's authoritative player, opponent, format, game, and score identity instead of inferring a new game from changing board controls.
- Updated RiftAtlas controls, Ivern's Brush battlefield replacement, temporary overlays, and ordinary board changes no longer create repeated match-review popups or turn best-of-one matches into false best-of-three series.
- Returning to the lobby after a completed best-of-one or best-of-three now finalises the correct match more consistently.
- If RiftAtlas loads only part of its lobby and the real play buttons are missing, RiftLite now detects the incomplete shell and performs its existing safe one-time recovery without deleting the user's sign-in or local decks.
- Deleting a capture from the review screen now releases the overlay and restores keyboard input to RiftAtlas correctly.

## Replay and export improvements

- MP4 export now validates the captured source, waits for safe finalisation, and reports useful progress and errors instead of silently producing a tiny or malformed file.
- Replay capture and review recovery are more resilient when a renderer or event queue is slow during match finalisation.
- Replay evidence gains improved card text, card-image hover support, and safer annotation editing for the coaching work being prepared.
- Battlefield and chosen-Champion evidence is classified more carefully, reducing false card-play and battlefield-overlay results.

## Labs and training

- Mulligan Lab and Sideboard Lab have clearer, more game-like feedback and stronger explanations for the evidence behind each result.
- Practice context now moves more reliably between a completed match, Mulligan Lab, and Sideboard Lab.
- Mulligan guidance retains the practical two-redraw baseline when an opening hand has no live 2-drop, while still showing when the available evidence suggests a deck-specific exception.

## Accounts, hubs, and community

- Legacy private hubs can now be claimed through a dedicated password dialog with clear success and error feedback.
- Match review, local recovery, and account-sync safeguards have been tightened to preserve saved data through interrupted flows.
- Zelonius replaces Bloody in the creator spotlight, including creator discovery and tracked social links.

## Insights preview

- The Insights navigation item remains available but now opens a clean Coming Soon page while the feature is redesigned around useful, visual, and actionable coaching.
- No match capture, replay capture, or historical evidence collection is disabled by the placeholder.

## Installation notes

- Updating preserves existing matches, decks, captures, settings, and account connections.
- Windows may show a SmartScreen warning because the installer is not yet Authenticode signed.
- Separate macOS builds are provided for Apple silicon and Intel. They are ad-hoc signed and not notarised, so first launch may require Control-clicking RiftLite and choosing **Open**, or approving it in **Privacy & Security**.
