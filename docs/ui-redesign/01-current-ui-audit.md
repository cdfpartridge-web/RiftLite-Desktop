# RiftLite current UI audit

Status: proposal only. This audit does not authorize changes to capture, match, account, deck, replay, sync, storage, API, or release behaviour.

## Executive summary

RiftLite already contains a broad and unusually capable product: automatic TCGA and RiftAtlas match capture, guarded BO1/BO3 lifecycle handling, local match history, two distinct replay systems, deck preparation, community analytics, Scorepad, social and private-hub tools, account continuity, and streaming/coaching utilities. The redesign problem is not missing capability. It is that the interface exposes most capability at the same level and makes users assemble their own mental model of how it fits together.

The current renderer has 18 sidebar destinations in six groups. Several destinations are alternate entry points into the same underlying workspace, while closely related tasks are split across different destinations. Account-bound Web Replay setup appears in both Account and Settings; local video replays and hosted Web Replays are adjacent but use the same word; Deck Library and Matchup Prep are separate sidebar items backed by one deck workspace; personal Stats, Matchup Lab, Meta & Matrix, and Community Decks overlap conceptually without a shared analytics model in the UI.

The current Home screen acts partly as a launchpad and partly as a marketing/community feed. It includes useful shortcuts, an active deck, and the latest match, but it does not make the user's operational state obvious: whether match tracking is ready, what will happen when a match ends, whether a review is pending, whether replay upload is healthy, or which integration needs attention.

The product should therefore be reorganized around the user's loop:

1. Get ready.
2. Play and track.
3. Review the result.
4. Learn and prepare.
5. Share or collaborate when wanted.

The safest implementation is a presentation shell around existing callbacks and data contracts. The current domain behaviour should remain behind adapters while navigation, hierarchy, state presentation, and shared components are changed incrementally.

## Audit basis

This audit is based on:

- `docs/CURRENT_STATE.md` and `docs/HANDOVER_2026-07-17.md`;
- account, cloud-sync, Replay V2, and Web Replay handovers;
- the current `src/renderer/App.tsx`, `src/renderer/RiftLiteReplayViewer.tsx`, and `src/renderer/styles/app.css`;
- shared settings/types and the current service boundaries described by the source;
- tests covering capture, BO1/BO3 session tracking, result review, deck persistence/tracking, replay lifecycle, account identity, cloud sync, and store recovery.

The current renderer is concentrated in `App.tsx` (about 25,700 lines) and a single global stylesheet (about 13,200 lines). This is an implementation risk, but it is not by itself evidence that the product needs a rewrite.

## Current navigation inventory

| Group | Destination | What it currently opens | Audit finding |
| --- | --- | --- | --- |
| Start | Home | Launchpad, featured content, shortcuts, latest match, active deck | Useful content competes with operational readiness and next actions. |
| Start | Play | Embedded TCGA/RiftAtlas, capture controls, tracker/prep overlays | Core destination; health and recovery are visually secondary. |
| Review | Matches | Local history, extensive filters, testing sessions, bulk sync, edit/delete | Core, but dense; selection, filtering, testing, sync, and repair share one surface. |
| Review | Replays | Local video/keyframe library, import, health, coaching and export | “Replay” is ambiguous because Web Replay is separate. |
| Review | RiftLite web replay | Embedded RiftLite.com library with account bootstrap | Separate system is correct, but terminology and setup ownership are unclear. |
| Review | Stats | Personal local analytics and match matrix | Overlaps with Matchup Lab and community analytics. |
| Review | Matchup Lab | Personal/community matchup context, deck comparison, prep, replay evidence | Valuable synthesis surface, but it is presented as another peer tool. |
| Decks & Prep | Deck Library | Shared deck workspace focused on library | Same underlying destination as Matchup Prep. |
| Decks & Prep | Matchup Prep | Shared deck workspace focused on prep | Duplicate top-level route; better as a deck workspace section. |
| Decks & Prep | Scorepad | Desktop/phone manual match logging | Supporting capture method; belongs near Play or Matches, not between deck tools. |
| Community | Community Decks | Public deck snapshots and card/battlefield inclusion | Closely related to Meta & Matrix and Matchup Lab. |
| Community | Meta & Matrix | Legend meta, matrix, community recent matches | One destination contains three internal tabs while Community Decks is separate. |
| Community | Spotlight | Creators, teams, media, community projects | Low-frequency discovery content; should not displace the core loop. |
| Social | Find Match & Teams | LFG rooms, public teams, applications/moderation | Two distinct jobs combined under one label. |
| Social | Private Hubs | Hub membership/admin, health, sync, messages, stats | Important collaboration and diagnostic surface; very dense. |
| Tools | Overlay | OBS overlay configuration, text outputs, simulator bridge | Advanced creator tool; appropriately separable but too prominent for most users. |
| Tools | Account | Identity, profile, connection, cloud, Web Replay/Discord consent, search, data | Multiple independent state machines appear as one long page. |
| Tools | Settings | Profile, privacy, replays, capture, tracker, audio, import, backup, toolkit, diagnostics, updates | A catch-all page with duplicate account/replay controls and no category navigation. |

## Feature and functionality inventory

Classification used below:

- **Core**: part of the normal play-review-improve loop.
- **Supporting**: common but not required for every user.
- **Advanced**: specialist, creator, organizer, or power-user capability.
- **Diagnostic**: support/recovery rather than normal workflow.
- **Hidden/parked**: retained in code but not a current product entry point.
- **Duplicate entry**: valid capability exposed in more than one place.

| Capability | Purpose | Current location and reach | Primary users / frequency | Important dependencies | Class |
| --- | --- | --- | --- | --- | --- |
| TCGA embedded play | Play TCGA while RiftLite observes match evidence | Play; TCGA platform toggle | Digital players; every session | game webview, preload/debug capture, capture coordinator | Core, sensitive |
| RiftAtlas embedded play | Play RiftAtlas with automatic evidence and raw Web Replay capture | Play; Atlas toggle | Digital players; every Atlas session | persistent webview partition, Atlas bridge, recovery, deduper | Core, sensitive |
| Capture health | Show idle/detected/review/error state | Small sidebar footer control; details rail on Play | Everyone; passive/continuous | capture coordinator and health contract | Core + diagnostic |
| Atlas site-state repair | Clear only Atlas cache/service worker state and reload | Play toolbar and recovery prompt | Affected users; rare | isolated Atlas partition/recovery IPC | Diagnostic, sensitive |
| Game refresh/hard refresh | Recover embedded game page | Play toolbar | Players; occasional | webview lifecycle | Supporting |
| Game zoom | Scale embedded game surface | Sidebar utility | Players with display/scaling needs | webview zoom persistence | Supporting |
| Automatic match detection | Build match evidence and trigger review | Background while Play is open | Everyone; every captured match | preload/debug paths, dedupe, tracker, coordinator | Core, highly sensitive |
| BO1/BO3 lifecycle | Keep child games, sideboarding, scores, seats and completion together | Invisible until review/history | Competitive players; every series | match session tracker, coordinator, identities | Core, highly sensitive |
| Match review modal | Confirm/correct captured result, games, legends, score, seat, decks, flags, notes | Global modal after capture; Edit from Matches | Everyone; every captured match | draft schema, storage, sync intent, deck list | Core, highly sensitive |
| Local match history | Browse and edit saved matches | Matches | Everyone; frequent | local store and match contracts | Core |
| Match filters/export | Slice history by legends, deck, result, platform, format, source, seat, date, sync, notes, sessions | Matches | Competitive/power users; frequent | normalized match fields | Supporting |
| Bulk hub/team sync | Send selected saved matches to chosen destinations | Matches | Hub/team users; occasional | account identity, membership, Firebase sync | Advanced, sensitive |
| BO3 repair/combine | Combine two BO1 rows and undo the repair | Matches modal | Users repairing historical capture; rare | match combine helpers and storage | Diagnostic, sensitive |
| Testing sessions | Label a focused block of matches and export it | Matches | Testers/coaches; occasional | local session state, decks, matches/replays | Advanced |
| Personal stats | Record, win rate, legend meta, matrix, drilldowns | Stats | Competitive players; frequent | local reviewed matches, hidden-from-stats rules | Core |
| Matchup Lab | Combine personal matchup, community context, deck comparison, prep and replay evidence | Matchup Lab | Competitive players; frequent before events | local/community matches, decks, replays | Core supporting |
| Deck import/refresh | Save decks from supported URLs/text/files | Deck Library | Deck users; weekly/when lists change | deck import/parser and saved deck contracts | Core |
| Active deck | Mark the deck used by tracker, prep and overlay | Deck detail/Home | Deck users; session-level | settings activeDeckId, deck persistence | Core |
| Deck versions/performance | Attribute results to deck snapshots and compare versions | Deck Performance/Notebook | Competitive deck builders; weekly | snapshot hashes, match association | Supporting |
| Deck notebook/watchlist/goals | Track hypotheses, card performance and notes | Deck Notebook | Competitive/test teams; weekly | local notebook schema | Advanced |
| Matchup prep guides | Visual keep/consider/avoid, sideboard, battlefield and notes per matchup | Matchup Prep and in-game prep overlay | Competitive players; per matchup/session | active deck, notebook guide fallback | Core supporting |
| Event deck tracker | Count visible local deck events and opponent observations; sideboard memory | Play overlay; Settings | Atlas deck users; every supported match | active deck, Atlas events, tracker service | Supporting beta, sensitive |
| Vision tracker | Experimental screenshot recognition | Hidden/disabled, debug code retained | Internal testing only | worker/vision heuristics | Hidden/parked |
| Scorepad desktop | Score or quick-log table matches into review | Scorepad | Paper/event players; per round | same MatchDraft review/storage contract | Supporting, sensitive result path |
| Phone Scorepad | Pair phone link and import queued logs | Scorepad | Event players; occasional | website inbox/ack, device secret | Advanced, sensitive |
| Local video replay capture | Record direct game frame, optional mic and shadow clips | Settings and Play controls; Replays | Coaches/creators; per session | MediaRecorder, game frame, file paths | Core supporting, sensitive |
| Local replay library | Search/filter/import recordings and inspect media health | Replays | Coaches and reviewers; frequent | replay store and filesystem | Core |
| Replay detail/playback | Fullscreen, speeds, seeking, audio, keyframes, event views | Local replay detail | Coaches/creators; frequent | video/keyframes/event evidence | Core supporting |
| Replay coaching layers | Flags, drawings, voice notes, review route, coaching packs | Replay detail | Coaches/content creators; frequent for selected games | replay annotations/layers/media | Advanced |
| Replay export/clips | Export MP4/clips and packages | Replay detail | Creators/coaches; occasional | ffmpeg and file handling | Advanced |
| Replay health/media recovery | Explain missing/incomplete media and recover/import loose files | Replays/detail/import | Affected users; rare | filesystem scan and replay metadata | Diagnostic |
| First-party Web Replay | Automatically upload Atlas raw capture and play privacy-projected canonical replay | Account, Settings, Web Replay, Replay detail | Atlas users; per match | linked account, explicit consent, raw capture, website | Core supporting, highly sensitive |
| Web Replay library embed | View public or account-owned hosted replays | RiftLite web replay | Atlas reviewers; frequent | short-lived HttpOnly embed session | Core supporting, sensitive |
| Discord replay reporting | Post future or selected Unlisted replay links to configured hub reports channels | Account; Replay detail; Hub Health | Private hubs; per match | consent snapshot, finalized score, hub membership, server delivery state | Advanced, highly sensitive |
| Old local reconstructed Replay Lab | Local raw-data player/diagnostic engine | Code retained, normal entry hidden | Internal diagnostics | raw Atlas engine/viewer | Hidden/parked |
| Legacy third-party RiftReplay upload | Upload raw captures using endpoint/API key | Advanced raw capture settings/diagnostics | Legacy diagnostics only | separate consent and endpoint credentials | Deprecated/diagnostic |
| Account link/reconnect | Associate desktop with website identity without losing local data | Account | Account users; setup/rare recovery | link session, token exchange, canonical aliases | Core supporting, highly sensitive |
| Profile and privacy | Handle, display name, discoverability and public sections | Account | Social/account users; setup/occasional | website profile contract | Supporting |
| Connection verification/repair | Verify website, desktop, replay ownership and aliases | Account | Affected users; rare | canonical/alias identity graph | Diagnostic, highly sensitive |
| Account cloud sync | Immutable cloud backup generation, restore and conflict choice | Account | Multi-device users; occasional | account auth, store backup contracts | Supporting beta, highly sensitive |
| Local backup/restore | Export/replace local app data with a safety backup | Settings | Everyone; rare | store transactions and backup schema | Supporting, highly sensitive |
| Community legend meta/matrix | Aggregate public user-submitted results | Meta & Matrix | Competitive players; weekly | Firebase community sync and privacy flags | Supporting |
| Community deck analytics | Show public snapshots, inclusion, choices and battlefield data | Community Decks | Deck builders; weekly | public community deck snapshots | Supporting |
| Recent community matches/alerts | Show current results and meaningful shifts | Meta & Matrix | Competitive players; weekly | community sync/cache | Supporting |
| LFG rooms | Post/find room codes with format/preferences/expiry | Find Match & Teams | Social players; session-level | account, remote social service | Supporting |
| Public teams | Create profiles, membership/applications and match sync | Find Match & Teams | Teams/organizers; occasional | account identity, team service | Advanced |
| Private hubs | Join/create hidden groups and privately sync selected results | Private Hubs | Testing groups; weekly | account/hub identity, Firebase sync | Advanced, sensitive |
| Hub Health | Diagnose exact hub/account/Discord/replay delivery | Private Hubs | Owners/co-owners/support; rare | website health endpoint and current identity | Diagnostic, sensitive |
| Hub roles/invites/messages | Owner/co-owner/member administration and communication | Private Hubs | Organizers; occasional | capability model and account membership | Advanced, sensitive |
| Stream Overlay | OBS landscape/portrait URLs, session/deck/match display | Overlay | Streamers; per stream | local overlay server and settings | Advanced |
| Simulator bridge/text outputs | Feed simulator events and OBS text files | Overlay | Advanced creators; per setup | local server/files | Advanced/integration |
| Screenshots/toolkit | Save board screenshots and configure hotkey/folder | Play toolbar and Settings | Reviewers/creators; occasional | game webview and filesystem | Supporting |
| Diagnostics bundles | Inspect event mix, evidence and export support bundle | Settings advanced/Capture Lab | Testers/support; rare | diagnostic log files | Diagnostic |
| Updates/import/recycle bin | Update client, import legacy data, restore deleted items | Settings | Everyone; rare | updater/store migration/soft delete | Supporting + diagnostic |
| Spotlight/home media | Promote creators, streams, videos and support links | Home/Spotlight | Community discovery; occasional | remote home config and embedded media | Supporting, low frequency |

## Frozen behaviour and redesign boundaries

The following are presentation inputs, not redesign targets:

- Capture must continue accepting evidence through the existing preload/debugger path and central Atlas deduper.
- A BO3 remains one match/series with distinct child-game identities; equal scores are not dedupe keys.
- Review timing, pending-result handling, sparse end evidence, and result persistence remain unchanged.
- TCGA and Atlas behaviour remain isolated where their evidence differs.
- Active deck, deck versions, notebooks, prep guides, sideboard tracking, and existing persisted formats remain compatible.
- Local video replay, first-party Web Replay, old local Replay Lab, and legacy third-party upload remain separate systems.
- Web Replay capture/upload and Discord sharing remain explicit, account-bound consents; visibility is never broadened implicitly.
- Account identity remains an additive canonical/alias graph. Reconnect is not “create a replacement account.”
- Cloud restore, local restore, hub sync, and replay delivery keep their current transactional and retry semantics.
- Overlay, diagnostics, background work, filesystem paths, APIs, IPC, authentication, storage, and release behaviour remain unchanged.

## Terminology findings

| Current term(s) | Problem | Proposed product language |
| --- | --- | --- |
| Replays / RiftLite web replay / Replay Lab / RiftReplay | Four systems share nearly the same name. | “Local replays” for recorded media; “Web replays” for hosted Atlas reconstructions; keep “Replay Lab” internal only; label legacy upload as diagnostic. |
| Atlas / RiftAtlas | Provider name and technical source are mixed. | “RiftAtlas” in user-facing navigation; “Atlas capture” only in diagnostics and technical copy. |
| TCGA | New users may not know the acronym. | “TCGplayer (TCGA)” on first use, then “TCGA.” |
| Device sync / Account Cloud Sync / Backup and restore | Sync and backup semantics blur together. | “Account backup” with explicit “Back up this device” and “Restore from account”; “Local backup” for files. |
| Matchup Prep / Prep Guides / Testing notebook | Same deck knowledge is fragmented. | “Deck workspace” with “Overview,” “Prep,” “Notebook,” and “Performance.” |
| Stats / Meta & Matrix / Matchup Lab | All sound like analytics destinations. | “My stats,” “Community meta,” and “Matchup Lab,” with clear data-source badges. |
| Overlay | Does not say who it is for. | “Stream overlay.” |
| Review captured match / Local match history | Strong but inconsistent workflow naming. | Use “Match review” for the confirmation step and “Match history” for saved records. |
| Sync | Can mean community, hub, team, cloud, replay upload, or Discord. | Always qualify: “Account backup,” “Hub sync,” “Team sync,” “Replay upload,” or “Discord report.” |

Use `BO1` and `BO3` consistently in user-facing text. Persisted enum values such as `Bo1`/`Bo3` do not need to change.

## Duplicate and competing entry points

1. **Web Replay setup:** automatic upload and visibility controls appear in Account and Settings, while manual upload/share appears in replay detail and health appears in Private Hubs. Keep the actions, but make Account & integrations the owner and use read-only status/deep links elsewhere.
2. **Deck Library and Matchup Prep:** both navigate to the same `DecksView` with a focus value. Make one primary “Decks” entry and preserve four internal sections.
3. **Replays and Web Replay:** these are legitimately different systems but need a shared Review landing page and explicit Local/Web labels.
4. **Analytics:** Stats, Matchup Lab, Meta & Matrix, and Community Decks repeat filters and drilldown concepts. Keep separate data products but share source labels, filter patterns, and cross-links.
5. **Account identity and Settings profile:** Settings includes a basic Profile while Account owns the durable profile. Remove identity ambiguity by making the account surface authoritative.
6. **Capture diagnostics:** the footer health button, Play details rail, Settings diagnostics, Capture Lab, replay raw-capture panels, and Hub Health each expose different slices. Retain them, but route all actionable failures through one status model and scoped recovery link.
7. **Home and Spotlight:** Home embeds featured community/media modules while Spotlight exists as a destination. Home should prioritize readiness and recent work; Spotlight can own long-form discovery.

## Current state-model findings

The domain services contain careful state machines, but the renderer often reduces them to prose strings or independent booleans.

- Startup has one full-screen “Starting RiftLite” state without staged progress, retry, safe-mode, or recovery guidance.
- First-run setup is rendered only after the user navigates to Play, even though Home is the default destination. It therefore cannot orient the user before the first broad dashboard experience.
- Capture health is present globally but compressed to an icon in a 46px footer control. Users can miss “review needed” or a recoverable issue.
- The current health label maps both idle/loading fall-through states to “Ready,” which overstates certainty before the bridge/provider is actually ready.
- Play has normal content, recovery prompt, capture progress, update prompt, right rail, deck tracker, prep overlay, and review modal competing in the same spatial layer.
- The Web Replay wrapper models loading/authenticated/error and has a browser fallback, but the embedded webview itself has no visible in-page lifecycle model for a blank renderer, offline state, or navigation failure.
- Account separately loads profile, connection, link session, cloud status, consent and hub destinations. A single free-form `status` line can report an older operation while another card has changed state.
- Settings mostly saves immediately and reports status locally; there is no consistent pending/saved/failed component or dirty-state rule.
- Many empty states explain what will appear but do not provide the best next action.
- Offline/disconnected state is contextual and inconsistent. Community, account, Web Replay, hub health, update checks, and external embeds fail differently.
- Several bootstrap/community/hub/team failures are normalized to empty arrays or “Loaded 0,” so a failed load can look like a genuinely empty product. Community may also fall back to locally ready rows without a persistent provenance label.
- Import, upload, sync, and recovery progress use ad hoc text rather than a shared operation pattern with retry and diagnostics.
- Success feedback often disappears quickly or sits away from the initiating control.
- Global action feedback always uses success/check styling even when the message reports a failure, so visual severity can contradict the words.

The redesign should not merge the underlying state machines. It should map them into a consistent presentation model:

`idle | working | ready | attention | failed | unavailable`

Each status presentation should also carry `scope`, `lastUpdated`, `primaryAction`, `secondaryAction`, and an optional `diagnosticRef`. That is a UI adapter, not a storage/API change.

## Layout, visual, and accessibility findings

- The current dark palette is coherent, but frequent cyan/violet gradients, glow, bordered cards, nested panels, and uppercase micro-labels give many elements equal visual weight.
- The audited stylesheet contains 117 gradients, 80 shadow declarations, and 249 declarations at 10–12px. These counts reflect accumulated styling rather than a component-level visual contract.
- Text frequently uses 9–12px sizes; this is particularly risky for data-heavy replay, tracker, matrix, and navigation contexts.
- The 220px sidebar is reduced to icons at 1180px and removed entirely below 900px without a replacement primary navigation in the current stylesheet.
- Several specialist views assume a large desktop canvas or minimum height. That is acceptable for Play and video replay, but supporting controls still need a legible compact mode.
- Global CSS has accumulated multiple generations of selectors. Similar components can look different based on source order rather than a deliberate variant contract.
- The renderer uses at least 86 `rail-card` instances alongside `home-card`, `compact-panel`, `panel-card`, `wide-panel`, and feature-specific containers, making hierarchy depend on locally invented card chrome.
- Card nesting is common (`rail-card`, `compact-panel`, specialized cards inside page cards). Hierarchy often depends on borders/backgrounds rather than spacing and headings.
- Buttons use several visual names but action priority is inconsistent; destructive, primary, secondary, segmented, icon-only, and link-like actions can sit in one undifferentiated row.
- Many icon-only controls rely on hover titles. Keyboard/screen-reader labels are sometimes present, but this should become a component rule.
- Dense filter grids expose every option by default. Common filters should be immediately visible; advanced filters should be progressively disclosed without hiding active constraints.
- Color-coded result/status states generally include text, which is good. This should remain mandatory.

## Tight UI/business-logic coupling

These areas require extra protection during later implementation:

| Area | Coupling | Redesign rule |
| --- | --- | --- |
| Root `App` | Owns startup, settings migrations, webviews, capture/replay media lifecycle, global IPC listeners, notifications and navigation | Add a new shell around existing state/callbacks first; do not move capture effects while restyling. |
| Play pointer/focus handlers | Arming video capture is tied to pointer and webview focus/navigation | Preserve event attachment and ordering; presentation wrappers must not swallow events. |
| Match review modal | Normalizes and writes the same draft used by tracker/storage/sync | Restyle fields in place before any component extraction; preserve save/delete/close semantics. |
| Account page | UI actions call link, verification, repair, consent, cloud upload/restore, unlink/switch directly | Separate visual cards via adapters, not by recomputing identity state in components. |
| Settings | Toggle enablement encodes account, replay and capture guardrails | Preserve existing disabled predicates and save patches exactly during visual phases. |
| Deck workspace | Active deck and focus sections affect tracker/prep/overlay behaviour | Navigation changes may alter focus only; never remap IDs or notebook data. |
| Replay detail | Playback, flags, annotations, voice notes, layers, clips, raw upload and Discord share share local state | Introduce visual grouping without changing timelines, IDs, save ordering, or visibility confirmation. |
| Matches | Filtering, testing sessions, combination, sync, edit and delete are co-located | Split presentation sections while reusing existing selectors/actions. |
| Hubs | Permissions, selected hub, health, sync, invite and role actions depend on live capability state | Never infer capability from visible role labels; continue to use server/service results. |

## Product problems to solve first

1. **Readiness is hidden.** Users cannot answer “Am I ready to play and what will RiftLite do?” at a glance.
2. **Navigation mirrors feature accumulation.** Eighteen peers make common tasks and specialist tools look equally important.
3. **Replay/account terminology is ambiguous.** Users must understand architecture to configure outcomes safely.
4. **Status and recovery are fragmented.** Robust backend states are collapsed into inconsistent inline messages.
5. **Density is unprioritized.** Long settings, account, replay, hub, deck, and match pages expose everything before the user asks for it.
6. **Responsive navigation is incomplete.** Compact widths remove labels and then navigation itself.
7. **The renderer is a risky change surface.** UI work can accidentally disturb live match and media behaviour unless changes remain thin and reversible.

## Audit conclusion

RiftLite should keep its feature depth and existing domain architecture. The redesign should create a clearer product shell, a status-first dashboard, task-based grouping, consistent state components, and progressive disclosure. The first implementation should not extract services, replace routing, or rewrite screens. It should prove that hierarchy can improve while the existing callbacks, props, persistence, and tests remain untouched.
