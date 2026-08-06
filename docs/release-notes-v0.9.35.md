# RiftLite Beta v0.9.35

RiftLite v0.9.35 improves match-review reliability and protects captures when a local save is interrupted.

## What's fixed

- Choosing **Review later** now safely keeps the match in Match History before closing the review.
- Match details and replay files are preserved together while a review is deferred.
- A failed save keeps the review open and shows a clearer error so it can be retried.
- Matches awaiting review are labelled **Review needed** and stay out of stats, deck performance, Matchup Lab, and stream overlays until confirmed.
- Additional safeguards prevent an older pending review from overwriting a match that has already been saved or synced.

Existing local matches, decks, recordings, and replay files remain intact when updating.
