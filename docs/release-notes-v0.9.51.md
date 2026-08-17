# RiftLite Beta v0.9.51

RiftLite v0.9.51 is a major training and reliability release. It adds two new data-backed practice modes, makes Atlas capture and app startup much more resilient, and replaces the Windows installer component that could crash on newer Windows 11 builds.

## New: Mulligan Lab

- Practise real four-card opening hands in **Daily 5**, active-deck, chosen-matchup, mixed, and review modes.
- Compare your choices with anonymised, contributor-balanced community keep and redraw patterns. A single prolific player cannot dominate the guidance.
- See clear green, rose, and amber feedback without turning descriptive community behaviour into a claim that one line is always correct.
- Use contextual curve, initiative, matchup, and pre-season/current-season evidence when enough independent data exists. Broader Legend-level tendencies remain clearly labelled and are not treated as hard grades.
- A separate 2-drop curve check highlights the usual two-redraw baseline when no printed 2-cost Unit is present, while allowing Champion- and deck-specific exceptions.
- When the captured setup proves the face-up Chosen Champion and exact 35-card replacement pool, RiftLite can also show the real chance of finding a live 2-drop with one or two redraws.
- Runs now include completion recaps, local review practice, keyboard shortcuts, selection-limit feedback, official card zoom, and a first-use guide.

## New: Sideboard Lab

- Practise real, anonymised sideboarding scenarios from completed Atlas best-of-three matches.
- Choose **Daily 5**, an active deck, a matchup, mixed practice, or saved review items, with Game 1 result and Game 2/Game 3 context where supported.
- The interface now behaves like a small match stage: run pips, a live swap meter, reveal feedback, and clear progress through each scenario.
- Main-deck cards show the number of copies remaining: press **−** to take a copy out and **+** to return it. Sideboard cards begin at zero: press **+** to bring copies in.
- RiftLite enforces balanced one-for-one swaps, permits a valid zero-swap plan, and recognises legal Chosen Champion changes.
- Community evidence uses the opportunities where a card was actually available, with quantity patterns, coherent in/out packages, pre-season/current-season context, and descriptive—not causal—next-game results.
- Sparse scenarios are labelled as exploration rather than scored challenges. The Lab does not expose another player's exact plan or call an entire sideboard plan right or wrong.
- A first-use guide explains the controls, evidence colours, and privacy model.

## A smoother training loop

- Match details can now open the relevant Lab with the deck, Legends, seat, and prior-game context already selected.
- The two Labs can hand a completed practice context to one another without copying answers or evidence.
- Training progress and review items stay on your device and resume safely without leaking into a different deck or matchup.
- A new Home guide introduces both Labs, and permanent **How it works** controls let you reopen the explanations at any time.

## Capture and review reliability

- Returning to the confirmed Atlas lobby now finalises an explicit best-of-one or completed best-of-three promptly, so the match-review popup appears automatically again.
- Atlas card pickers and other temporary overlays are tolerated while the URL is still a live game route; lobby adverts and labels no longer keep an ended recording alive.
- Incomplete best-of-three series remain protected by the main series tracker instead of being ended after Game 1.
- Manual **Stop** no longer waits indefinitely for a stuck renderer event queue. RiftLite preserves the capture and continues recovery after a bounded wait.
- Review and replay work continue safely after the match is stored, reducing false incomplete reviews and avoiding unnecessary blocking.

## Startup and Windows installer fixes

- RiftLite now shows a lightweight startup window immediately, before local database work begins, with useful stage and recovery messages instead of appearing only in Task Manager.
- Reopening RiftLite during startup now restores, shows, and focuses the existing window; activation can also recreate a missing window safely.
- Legacy database import and stored-replay migrations now have durable completion markers, preventing the same expensive work from repeating on every launch.
- The Windows package now uses electron-builder 26.15.3 and the NSIS 3.12 toolset. This replaces the legacy `System.dll` associated with installer crashes on Windows 11 25H2.
- Release verification now checks the installer archive, executable metadata, updater manifest, packaged identity, FFmpeg, and packaged startup before publication.

## Lower background usage and safer private-hub sync

- A failed optional Web Replay link can no longer turn an already successful private-hub match upload back into a failed match report.
- Replay-link retries are now single-flight, limited to enabled and claimed hubs, classified as terminal or retryable, and stored with bounded exponential backoff instead of repeating every two minutes forever.
- Startup Web Replay reconciliation is capped, and disabled or stale destinations no longer enter settled-report recovery.
- Home live-takeover checks now pause while RiftLite is hidden, unfocused, or offline; they use a slower idle cadence and back off after failures.
- These changes preserve match, hub, replay, and takeover functionality while substantially reducing unnecessary network and database activity.

## Home, accounts, and card data

- Home can optionally adopt the domain colours of your active deck. The opt-in introduction explains the change, and semantic success/warning/error colours remain untouched.
- Live takeover viewing now supports anonymous, consent-gated impression and watch-duration measurement. It records aggregate viewing statistics only when diagnostics consent is enabled, without collecting personal browsing history.
- Account linking retries a transient transport failure once and now gives clearer, actionable connection guidance without claiming an account change was made.
- The packaged Riftbound registry now retains validated printed Energy and Power values for collectible cards, enabling trustworthy curve checks without guessing from names or artwork.

## Supporting online services

- Mulligan and Sideboard practice packs use the full indexed pre-season and current-season replay corpus, while the small daily exercise selection continues to rotate.
- Targeted practice can transparently fall back from an exact deck to a matchup or broader player-Legend cohort when privacy and sample thresholds are not met.
- Web Replays can now be deleted only by the signed-in account that uploaded them.
- Aggregate refreshes, Lab publishing, live-takeover delivery, and private-hub duplicate handling have been tightened to reduce unnecessary Firestore reads without removing customer-facing features.

## Installation notes

- Updating preserves your existing matches, decks, captures, settings, and account connection.
- Windows may show a SmartScreen warning because the installer is not yet Authenticode signed.
- macOS builds are provided separately for Apple silicon and Intel. They remain ad-hoc signed and are not notarised, so the first launch may require Control-clicking RiftLite and choosing **Open**, or approving it in **Privacy & Security**.
