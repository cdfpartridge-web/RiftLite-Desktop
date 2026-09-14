# RiftLite Beta v0.9.74 - Clearer review and Atlas match decks

Prepare and Review have a fresh layout, completed Atlas opponents' decks are easier to find, and match statistics give you a clearer picture of your results.

## Prepare and Review

- **A clearer deck library and matchup workspace.** Search artwork-led decks, focus on one task at a time, and edit matchup guides in stages.
- **Refreshed Matches, match review, Replays and Web Replays.** Find primary actions more easily, with secondary controls tucked away and existing drafts and playback preserved.
- **Plan-change warnings.** See when changed cards, quantities or battlefields affect a saved matchup plan. Your notes remain intact until you review and update them.

## Atlas match decks

- **Automatic opponent deck imports.** Completed saved Atlas matches pick up available history deck lists while you're signed in to Atlas, with background retries when history is delayed.
- **Deck beside Replay and Edit.** Open the opponent's list directly from match history, switch between BO3 games, compare sideboard changes, view your own list or copy a deck.
- **Add to Web Replay.** Attach available lists to your own Web Replay for its private Match decks panel. Private or unavailable Atlas lists are not revealed, and these full lists are excluded from public/community/hub/team match uploads.

## Better match data

- **Results & data.** See coverage of battlefields, initiative, scores and stored deck lists, plus BO3 game-one performance, conversions and comebacks with sample sizes.
- Missing information and incomplete series are handled more clearly; later BO3 games no longer inherit game one's battlefields in reports.
- TCGA battlefield tracking recognizes the current shared board slots and keeps generated Brush and Baron Pit from overwriting selected battlefields.

## Smoother everyday use

- **Keep all local only.** Clear eligible upload activity together with one confirmation, retaining local matches, replays and captures.
- **Move Mark decision.** Drag the in-game marker to a comfortable position; it remembers your choice and stays within the game frame.
- Fixes completed Atlas matches reopening unexpectedly after early exits or joining another room.
- Prevents repeated focus recovery from interrupting an already focused Atlas chat input.
- Updates the embedded Electron runtime to 39.8.10, including security fixes for browser popup handling.

## Good to know

- Existing profiles, matches, decks, replays, settings, media paths and `riftlite:` links are preserved.
- Replay Coach remains Coming Soon. Your Move and the Android prototype are separate work and are not introduced by this desktop release.
- macOS installers remain ad-hoc signed and are not Apple-notarized, so macOS may show its standard first-open warning.

## Validation scope

The release process checks TypeScript, automated behaviour tests, fresh packaging, updater manifests and isolated packaged startup. Signed-in gameplay, Atlas chat and automatic deck imports still require live acceptance; automated checks do not establish a completed live-match test.
