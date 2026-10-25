# BO3 All cards recurrence — local fixes, 25 October 2026

The user reported that the last couple of replays lacked All cards after the v0.9.87 publication. Investigation found two desktop defects. The normal replay captures and uploads remain intact. These corrections are local source only: no installer rebuild, installation, version change, push, publication, website deployment or production replay mutation was performed.

## Actual evidence

- Latest four completed captures are Kai'Sa versus Kennen, Azir, Diana and Vex, ending at 16:27, 16:06, 15:38 and 15:06 UTC respectively. All are BO3, uploaded and Ready, with valid account consent, unique captures and active saved parents.
- Anonymous production reads returned 200 for all four original unlisted replays and 200 with no available All cards games. This alone cannot distinguish a missing supplement from a deliberately private/stale supplement; local capture and collector evidence establishes the defects below.
- The installed local candidate displays 0.9.86, but its compiled main, collector, query, idle gate, capture coordinator, match tracker and raw-capture service are byte-identical to released v0.9.87. Simply updating to that release does not contain these new corrections.
- No `atlas-postgame-collection` stages appeared in retained logs after 15:20, despite the final game returning to the lobby. The legacy `atlas-history-auto-import` events are a different service.

## Defect 1: missing BO3 ending fields

Across ten games in the four captures, nine contain no `gameHistoryEndedAt` and no `gameOutcome`. The sole captured ending is the concession in the Kennen series' Game 3. All four series nevertheless contain valid snapshots, contiguous sequence evidence, stable participants/local player and one `seriesStartedAt`, plus coherent authoritative wins ending 2–0 or 2–1. Atlas moves individual games into distinct rooms.

The old missing-ending fallback supports only BO1 and a single room. Therefore extraction returned only Game 3 for Kennen and no games for the other three series. This occurrence was not caused by duplicate commits, missing snapshots, changed identities or size limits.

The correction recognises only a complete consistent BO3: exactly two/three rooms, games 1..N, matching series and participants, valid per-game identity/snapshot/sequence, coherent win increments and a final two wins. It creates completion-check candidates without fabricating winners or end timestamps. The guest still waits outside gameplay, checks current ownership and permissions, then independently requires a completed export matching the exact game and series across every frame. Existing BO1 and explicit-ending handling stays intact.

The same four original captures now yield [1,2,3], [1,2], [1,2,3] and [1,2]. All nine additional candidates retain exact series bindings and omit fabricated ending timestamps. Raw inputs were read in memory and remained unchanged.

## Defect 2: a finished board recreates an active capture

The saved Kennen match has a resolved champion name different from the raw terminal event's champion label. Two active snapshots repeat that same terminal label, room, opponent, game identity and final score after saving. The publication guard remembered only the saved champion name, so the snapshots failed its label comparison and recreated an active tracker. A following inactive lobby snapshot does not end that tracker. This blocks the collector's active-capture gate.

The correction remembers at most the exact saved and terminal champion labels per player, with a 256-character/control-character bound. Existing room, opponent, game-instance/history, result, finished-score and time guards remain unchanged. It adds no fuzzy or truncated matching.

A synthetic regression matching the actual three-game event sequence failed before the change with an active tracker left in the lobby. It now leaves capture clear and platform switching allowed. A genuine next game still starts; changed room, opponent, game identity, history, points or unrelated champion labels are not suppressed. The precise upstream reason for the raw/saved label difference was not separately established.

## Validation and next test

- All **3,184 tests across 264 files** and TypeScript passed after both corrections.
- Extractor: 76 focused tests, including 22 new cases; three positive regressions failed against the old source.
- Guest query: 101 tests, including 17 new BO3 confirmation/identity/privacy cases; six regressions failed before the correction.
- Capture coordinator: 95 focused tests, including seven new alias/lobby/new-game boundary cases; the actual-shape stuck-tracker regression failed before the correction.
- Independent source review found no blockers. Scoped diff whitespace checks passed.

Evidence is in `output/allcards-recurrence-20261025-1633/` and `output/allcards-web-availability-20261025-1633/`. Reports contain sanitized counts, enums and equality checks; raw captures, credentials and profile databases were not copied or modified. No authenticated Atlas requests or live attachment writes were made during this investigation.

A new local installer/restart is needed to test these corrections in the running app. Collection can retry eligible existing Ready replays within its current six-hour window after restart and a quiet signed-in Atlas lobby. Actual Atlas export retrieval, live attachment and rendered All cards for these four matches are not yet verified. Public desktop remains v0.9.87 at runtime `8c780a9d7bf62da3aa58f59c2364c5154a5f6991`; website remains unchanged. Preserve all older candidates and pre-existing dirty/untracked work.
