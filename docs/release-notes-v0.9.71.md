# RiftLite Beta v0.9.71 — What’s new since v0.9.65

RiftLite v0.9.71 brings together the work completed since v0.9.65: a much more useful Deck Insights experience, opt-in decision capture, clearer replay timelines, stronger coaching-note exports, easier sharing, and a substantial set of Web Replay tools.

## At a glance

- **Learn from the deck you actually played.** Deck Insights now focuses on deck shape, matchups, captured card evidence, and questions worth reviewing.
- **Remember the decision, not just the result.** Enhanced Insights Beta can mark the exact moment of a decision and add the context later in Match Review.
- **Read replays with less noise.** Player, opponent, score, and game-start tags are colour-coded, conservative, and controlled by default-off toggles.
- **Share the useful part.** Create deck summary images, replay clips, and timestamped note links without changing the original replay.

## Desktop v0.9.71

### Better reviews and saved records

- **No more ghost-review lockout.** A stale “review needed” state can clear without a restart, so it should not block the next game. Genuine pending reviews remain available.
- **Correct saved Scorepad records.** Open a saved manual/Scorepad match from Matches, choose **Edit**, and correct the legend, score, format, and related details. Affected older entries are not renamed automatically; edit and save them to apply the corrected canonical legend name.

### Deck Insights that lead somewhere

- **Deck Insights is the default Insights experience.** Select a saved deck and review its local record, win rate, streak, curve, copy profile, card types, recent form, matchups, filters, and evidence coverage.
- **Focused Card Review replaces the old usage wall.** Select one card to inspect verified Game 1 and post-board appearances, pre-play hand conversion, mulligan choices, first-play timing, source/turn role, recycle/discard evidence, and cautious questions to revisit.
- **Honest evidence labels.** Older or partial captures show limited or unknown evidence instead of turning missing data into a claim.
- **Copy report now works.** The button uses RiftLite’s trusted desktop clipboard path and shows **Copying…**, **Copied!**, or **Copy failed**. It copies a text report; it does not create an image.
- **Replay Coach is Coming Soon.** The unfinished coaching analysis is not run in this build. Deck Insights remains fully available while Coach is refined.

### Enhanced Insights Beta

- **Clear first-run explanation and explicit controls.** Enhanced capture and the optional post-game question are separate opt-ins, and the introduction can be reopened from Settings.
- **Mark decision records the exact local moment.** During an opted-in match, use **Mark decision** when something worth reviewing happens. It keeps the timestamp even when video recording is off.
- **Add the “why” in Match Review.** Classify a decision as intentional, forced, missed, worth repeating, uncertain, or a bad capture, then add the plan, constraint, alternative, testing goal, and your own note.
- **Local by design.** Enhanced decision context and evidence stay on the device, are stripped from account backups, and can be removed with **Delete captured data** in Settings.

### Clearer replays and stronger exports

- **Player and opponent timeline colours.** Automatic player events are green, opponent events red, and game/system events blue or neutral. Score badges show complete captured totals; ownership colours are applied only when attribution is safe, otherwise the marker stays neutral.
- **A quieter default.** **Show automatic events & scores** is off by default, remembers the device-local choice, and hides only generated pins. Manual flags, notes, voice notes, and clip controls remain available.
- **More accurate Atlas timing.** New captures preserve a bounded first-seen time for Atlas log rows. Inferred evidence can still support review tools, but it is no longer presented as a confirmed automatic pin at a misleading frame.
- **Full Voiceover is clearer.** The former **Presentation MP4** action is now **Full Voiceover**, with visible connection, recording, saving, export, success, and failure states. Cancelled or failed Full Voiceover exports retain the completed recording so it can be retried or discarded deliberately.
- **Coaching-note recording gives clear feedback.** **Record coaching note** now shows connecting, live elapsed recording, saving, the saved time and duration, and explicit failure or fallback states. Success appears only after the voice note has been durably saved.
- **Coaching-note MP4s are more reliable.** A Windows overlay timing race is repaired, and failures still stop safely rather than publishing an incomplete file.
- **Control coaching-note volume.** A device-local MP4 slider offers 50%–300% volume, defaulting to 150%, with improved voice-note mixing and limiting. It changes only the exported MP4 mix.

### Sharing and community

- **Share Your Deck at a Glance.** Create a 1200×675 deck image with card art, legend, deck name, win rate, games, and record. Copy the image, save a PNG, or copy prepared post text; rendering stays local.
- **X0TCG joins Creator Spotlight.** The desktop profile includes X0TCG’s competitive coaching and teaching focus, discovery tags, and direct links to Twitch, Metafy, X, YouTube, TikTok, and Linktree.

## Web Replay updates — Live on RiftLite.com

### See and combine more context

- **Cards Up** keeps opponent cards visible once they have been revealed or later proven to be in hand. Unknown cards remain hidden.
- **Replay Combiner** lets signed-in users combine two consented perspectives into a separate **Unlisted** replay. The original replays remain unchanged.
- **Alternate-art support** now resolves Crystal Rose VEN-SP printings, signatures and overnumbered variants, and token printings that previously fell back or appeared missing.
- **Sideboard-choice recovery** restores the local player’s choices when a replay’s authoritative deck patch contains the submitted list. Opponent choices remain hidden, and ambiguous evidence still fails closed.

### Clip, annotate, and share

- **Precise clip controls.** Use the current frame for the start, return to the replay, then reopen the clip editor and use the current frame for the end. Both handles can be dragged, times use minutes and seconds, and fine nudge controls help land on the right moment.
- **Clip links do not edit the original.** Copying a clip link creates a shareable view that starts and ends at the chosen points in another browser.
- **Timestamped notes.** Add, edit, delete, or move note markers. Selecting one seeks to that moment and shows the note in the right-hand panel.
- **Share notes deliberately.** Notes stay in the current browser by default. A shared-notes link carries view-only notes in the URL; anyone who can access the replay and has that link can read them. Clip links include only notes inside the selected range.

### Optional score and series tags

- **Score tags** are off by default and remember the browser-local choice. Green tags represent the player, red tags the opponent, and a click seeks to the score event. Ambiguous resets, simultaneous changes, and incomplete evidence are omitted.
- **BO3 game-start tags** use the same control to show purple **G1**, **G2**, and **G3** markers on valid multi-game replays. They seek to the exact game start and respect clip boundaries; single-game replays are unchanged.

### Creator video rotation

- **X0TCG is now in the YouTube rotation.** The verified X0 Riftbound channel has its own slot, and the carousel capacity increased so no existing creator was displaced.

## Good to know

- Older matches without structured capture may show limited evidence in Deck Insights.
- Replay Coach remains Coming Soon.
- Updating keeps the existing RiftLite profile, matches, decks, replays, settings, media paths, and `riftlite:` links.
- macOS installers are ad-hoc signed and not Apple-notarized, so macOS may show its standard first-open warning.
