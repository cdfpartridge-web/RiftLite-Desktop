# Screen-by-screen redesign plan

Status: design specification only. “Move” means information-architecture/presentation relocation, not a change to domain ownership, persistence, IPC, or API behaviour.

## Shared screen frame

Every non-immersive screen uses:

1. stable primary navigation;
2. a page header with title, one-sentence purpose, and no more than one high-emphasis action;
3. optional secondary navigation for the current product section;
4. a content region built from sections rather than nested cards;
5. contextual status beside the affected content;
6. a consistent activity/toast area for completed operations;
7. an expandable details/help area for diagnostics and technical identifiers.

The immersive Play and Local replay player screens may reduce shell chrome, but must keep a visible path back and a reliable status/control strip.

## 1. First-run onboarding

**Purpose:** get a user to one successful tracked or logged match while explaining only required choices.

**Primary actions:** Continue; Start playing. Secondary: Skip optional setup; Continue local-only.

**Hierarchy and layout:** a four-step focused panel: Welcome → Game source → Tracking check → Optional enhancements. A persistent summary shows chosen provider and what RiftLite will do. Do not show community/media marketing during this flow.

**Components:** stepper, provider choice, readiness check, optional active-deck selector, local recording option, account/Web Replay invitation, privacy explainer.

**States and help:**

- provider loading/failure with Retry and Open in browser;
- local-only success even when account/network is unavailable;
- account setup clearly optional for local capture;
- explanation links for Local replays versus Web replays;
- resume onboarding from the last presentation step without changing persisted domain defaults unexpectedly.

**Moves:** replace the current Play-only `FirstRun` strip as the primary onboarding presentation. Basic local username/capture defaults remain editable in Settings.

**Untouched:** existing settings keys, browser detection, provider partitions, capture defaults, account link flow and privacy defaults.

## 2. Home dashboard

**Purpose:** show readiness, recent work, the next action, useful learning signals, and sustainable marketing/revenue placements without confusing promotional content with app status.

**Primary action:** computed from existing state: Review match, Continue playing, Fix tracking, Choose deck, or Start playing.

**Hierarchy and layout:**

- top readiness strip across the page;
- clearly labelled featured-partner placement above the fold, beside or immediately after Next action;
- two-column operational row: Next action + Active deck;
- Recent matches as a quiet list/table;
- one Insights panel and one Replay/integration activity panel;
- persistent featured-content lane for creator, video, stream, Discord and RiftLite-support campaigns;
- three viable layout treatments: balanced revenue rail (recommended), revenue-forward hero, and session-first sponsor strip.

**Required content:**

- tracking health and selected provider;
- selected/active deck, legend and version, with the existing official legend image used as the art source;
- last three matches with local/Web replay availability;
- pending review or active testing session;
- next action;
- local recording and Web Replay delivery status;
- account/Discord/hub attention only when it affects an enabled outcome;
- one statistically responsible personal insight;
- one clearly labelled featured partner or sponsored campaign;
- visible access to featured creator, video, stream, Discord and support content.

**Components:** readiness strip, legend-driven active-deck summary, match rows, delivery-stage row, action banner, insight statement, featured-partner campaign, manually controlled feature carousel, click-to-play media preview. The deck card reads `SavedDeck.legend`, resolves it through the existing official `legendImageUrl(...)` mapping, and falls back cleanly when art is unavailable.

**States and help:**

- new/empty state offers Start playing, Log with Scorepad, Import deck;
- disconnected community/website does not replace local dashboard content;
- capture/replay attention explains scope and deep-links to the correct recovery;
- loading or failed remote promotional content uses stable local/fallback inventory and never appears as an app error;
- when no paid campaign is configured, the sponsor slot uses the neutral copy “Want to sponsor?” and “Contact bmucasts@gmail.com” rather than simulating a partner;
- Riftlab is the default featured creator treatment in the approved Home direction;
- operational attention can compress promotional detail, but does not silently remove the commercial slot.

**Moves:** Home retains the featured partner, creator, video, stream, Discord, community discovery and RiftLite-support opportunities in a more deliberate hierarchy. Community → Spotlight holds expanded profiles, catalogues and longer-form media rather than replacing Home marketing.

**Untouched:** Home data sources, remote home configuration, match/deck/replay IDs and current navigation callbacks.

**Interactive planning sample:** `prototypes/riftlite-dashboard-marketing-concepts.html` demonstrates the three dashboard layouts, Ready/Review/Attention/Offline states, manually rotated promotional inventory, and the proposed five-item navigation. It is isolated from the renderer and contains no application integrations.

**Approved-direction visual:** `mockups/riftlite-balanced-modern-dashboard-v2.png` shows the modern balanced revenue-rail treatment with Scorepad hidden in the collapsed Community menu, a neutral sponsorship enquiry, Riftlab, and a selected-legend-driven Active deck card using official Akali artwork. The earlier `mockups/riftlite-balanced-modern-dashboard.png` remains as a comparison.

## 3. Digital Play

**Purpose:** keep the game dominant while giving confidence that capture, deck prep, recording, and recovery are working.

**Primary action:** none during normal play. Status is primary. Contextual recovery becomes primary only on failure.

**Hierarchy and layout:**

- thin top strip: provider switcher, capture phase, active deck, recording state;
- embedded game fills the remaining canvas;
- utility cluster: Refresh, screenshot, microphone, More;
- optional right drawer for session/capture details;
- floating tracker and prep overlays remain over the game where configured.

**Components:** provider segmented control, status timeline, deck chip, recording indicator, utility menu, details drawer, provider repair banner.

**States and help:**

- Preparing capture bridge;
- Ready;
- Match detected;
- Game recorded / Series continuing;
- Waiting for result;
- Review ready;
- Capture attention with non-blocking play;
- Atlas state repair, reload storm or blank-shell guidance;
- webview navigation/offline failure distinct from capture bridge failure.

**Moves:** hard refresh, Atlas repair and capture details may live in More/diagnostics until needed. Screenshot and microphone remain direct if they are genuinely frequent.

**Untouched:** game webview stays mounted when navigating away; partitions, preload, focus/pointer media arming, zoom application, debugger fallback, tracker/prep behaviour, capture timing, and provider isolation.

## 4. Match review modal

**Purpose:** confirm or correct the captured/Scorepad result and save it confidently.

**Primary action:** Save match. Secondary: Review later/close where currently valid; Delete/discard remains destructive and separated.

**Hierarchy and layout:**

- header: matchup, source, format, capture confidence and why review opened;
- required section: result, score, legends, BO1/BO3 child games;
- optional section: deck, battlefields, seat, flags, notes;
- artifact section: local replay retention/status and Web Replay status explanation, clearly separate;
- footer: save state, validation, Save match.

**Components:** evidence summary, game accordion/rows, validated fields, active-deck suggestion, optional details disclosure, save-error banner.

**States and help:**

- BO3 “series continuing” is not shown as a modal until current coordinator rules emit a draft;
- Incomplete and ambiguous results retain existing validation/fallback behaviour;
- storage failure preserves the draft and exposes retry/support guidance;
- Scorepad source is labelled Scorepad even if a compatibility platform value remains in data;
- “Save local replay files” explicitly does not control first-party Web Replay raw capture/upload.

**Moves:** visual grouping only in the first sensitive phase.

**Untouched:** draft normalization, BO1/BO3 conversion, child-game identity, result derivation, deck association, flags/notes, sync intent, replay deletion/retention sequence, save/delete callbacks and IPC events.

## 5. Match history

**Purpose:** find, understand, edit, export, and deliberately share saved matches.

**Primary action:** none by default; Export becomes available in a quiet toolbar. Selection reveals contextual actions.

**Hierarchy and layout:**

- summary row: match count, filtered record and date scope;
- search plus four common filters (date, deck, result, format);
- active-filter chips and “More filters” for the remaining filters;
- readable match table/list;
- optional Testing session banner only when active;
- contextual selection bar for hub/team sync or BO3 repair.

**Components:** search, filter drawer, active constraints, table/list row, replay availability icons with text alternatives, selection action bar, testing session panel.

**States and help:**

- no matches: Play or Scorepad actions;
- filtered empty: Clear filters and keep filter values visible;
- related local/Web replay availability represented separately;
- sync errors preserve selection and name the destination;
- delete explains soft-delete/recycle-bin behaviour;
- repair/combine appears under Advanced repair, not ordinary row actions.

**Moves:** testing session creation collapses into a mode; bulk sync and BO3 repair appear only on selection; detailed metrics move to My stats.

**Untouched:** filter selectors, match ordering/upsert, edit/delete, CSV export, testing-session records, combine/undo logic, hub/team sync calls and hidden-from-stats rules.

## 6. Replays landing

**Purpose:** let users choose the correct replay system without understanding the implementation.

**Primary action:** the default opens the last-used tab. Import is contextual to Local replays.

**Hierarchy and layout:** a shared Review secondary nav and two labelled tabs:

- **Local replays** — recorded video, keyframes and local coaching artifacts;
- **Web replays** — hosted Atlas reconstructions and delivery state.

A concise explainer under each tab states storage, connectivity and privacy.

**Components:** tab control, library toolbar, result/status filters, replay rows/cards, match-artifact cross-link.

**States and help:** each tab owns its own empty/loading/offline/error model; an issue in Web Replay never makes Local replays look unavailable.

**Moves:** current `replays` and `web-replay` views become tabs/presentation siblings while retaining separate implementations.

**Untouched:** local replay store/files and hosted website embed remain separate.

## 7. Local replay library

**Purpose:** find and recover local replay media, then open playback/coaching.

**Primary action:** Open selected replay. Secondary: Import file/folder.

**Hierarchy and layout:** left/upper library list with search and platform/media/date/flag filters; selected replay summary; list-level media health; import actions in a menu.

**Components:** replay row, media-state badge, filter bar, import result banner, missing-media recovery action, folder shortcut.

**States and help:**

- no replays: explain how local recording is enabled and offer Import;
- no matching filters;
- Missing file versus Raw evidence only versus Incomplete recording;
- scan/import progress and per-file results;
- permissions/path error preserves existing records;
- a recovered file states which replay was reattached and why.

**Moves:** health summary appears at list level; raw Web Replay delivery status is not used as the main local-media badge.

**Untouched:** replay records, media paths, folder scan/import, conservative recovery matching, pagination/load-more and deletion.

## 8. Local replay detail

**Purpose:** watch, coach, and export one local replay without presenting every tool at once.

**Primary actions:** Play/Resume; mode-specific Coach or Export actions.

**Hierarchy and layout:**

- identity header: match, capture time, source, media state;
- playback stage and timeline;
- presentation modes: Watch, Coach, Export;
- collapsible Details: media health, raw capture/Web Replay delivery, match detail;
- contextual side panel in Coach mode.

**Components:** video/keyframe player, transport, marker timeline, flag list/editor, layer switcher, annotation tools, voice-note control, coaching pack, clip/export dialog, health details.

**States and help:**

- missing video falls back to keyframes/evidence where available;
- finalization/codec/size problems show precise status;
- voice permission and save failures remain local to the note control;
- export retains clip points/options after failure;
- manual Web Replay upload/share confirmation names visibility and destination;
- fullscreen and presentation mode always expose exit affordance.

**Moves:** coaching pack, Review mode, flagged moments, flags, layers and drawings become the Coach mode layout; raw capture/Discord stage moves to Details unless attention is required.

**Untouched:** media playback rates, seek semantics, flags/annotations/voice-note IDs, layers, hotkeys, clips/MP4, ffmpeg, capture timestamps, Web Replay upload and Discord visibility semantics.

## 9. Web replay library

**Purpose:** view public and account-owned hosted Atlas replays and understand delivery state.

**Primary action:** Open replay. Secondary: Retry library; Open in browser; Manage account when required.

**Hierarchy and layout:** native wrapper header shows connection/account state; the existing hosted library remains embedded beneath it. Future native list work is optional and not needed for the first redesign.

**Components:** account/connection banner, embedded webview frame, reload, browser fallback, delivery-stage summary for the latest local capture when relevant.

**States and help:**

- preparing embed session;
- authenticated owner library;
- public library fallback;
- account verification mismatch with a direct Account connection action;
- offline/navigation/render-process failure with Retry and Open in browser;
- blank-frame timeout with bounded diagnostic reference;
- processing/upload failure explained by stage, not a generic unavailable message.

**Moves:** Settings no longer owns duplicate upload controls; it links to Account & integrations.

**Untouched:** dedicated replay partition, cookie bootstrap, fixed routes, bearer/cookie permissions, website player/library code and privacy projection.

## 10. My stats

**Purpose:** understand personal reviewed match performance and drill into evidence.

**Primary action:** contextual “Study in Matchup Lab” or “Prepare this matchup.”

**Hierarchy and layout:** record summary, source/date/deck filter summary, matchup matrix, legend performance, recent matches. Data source label remains visible during drilldown.

**Components:** metrics, filter bar, matrix, accessible table alternative, drilldown panel, sample-size language, replay/prep cross-links.

**States and help:** no valid analytics matches, filtered empty, low sample, incomplete matches excluded from rate but counted where currently intended, Scorepad source labelled separately.

**Moves:** match-history operational filters stay in history; analytical filters live here. Shared visual patterns can later consolidate with community analytics.

**Untouched:** analytics validity, hidden-from-stats, source filters, result denominators, matrix calculations and match drilldowns.

## 11. Deck library and workspace

**Purpose:** import/select a deck and manage all work related to it.

**Primary action:** Import deck when library is empty; otherwise Set active / Open prep as context dictates.

**Hierarchy and layout:** deck list rail; selected-deck Overview; stable internal sections List, Prep, Notebook, Performance. Avoid rendering all long sections as one scrolling document in the proposed end state.

**Components:** deck row, active badge, overview summary, import panel, title/source/version actions, snapshot list, section tabs, unsaved indicator.

**States and help:** empty library, invalid paste/source, refresh failure, missing snapshot, active deck removed/cleared, no associated matches, notebook save failure.

**Moves:** Deck Library and Matchup Prep become one top-level Decks destination; current focus targets map to internal sections. Notebook and Performance gain equal section status.

**Untouched:** deck IDs/source keys, import/refresh/rename/delete, activeDeckId, snapshots, notebook keying/version hashes and match association.

## 12. Deck Prep

**Purpose:** create usable matchup guidance without overwhelming the user.

**Primary action:** Save guide.

**Hierarchy and layout:** select matchup; compact current-plan summary; three working columns/steps for Mulligan, Sideboard and Battlefields; General notes below; preview mode for the in-game overlay.

**Components:** opponent selector, default/specific guide indicator, Keep/Consider/Avoid lists, In/Out lists, battlefield priorities, note editor, copy/reset/export actions, visual card picker.

**States and help:** inherited default values are labelled; unsaved changes persist visually; copy/reset requires clear scope; cards outside valid deck sections remain rejected; missing images fall back safely.

**Moves:** import/export package and notebook utilities belong in Notebook or a deck Actions menu, not the Prep header.

**Untouched:** guide schema, fallback merging, sanitization, copy/reset/save logic, PDF/package formats, and manual-only in-game overlay behaviour.

## 13. Matchup Lab

**Purpose:** turn a personal weakness into evidence and a plan.

**Primary action:** Prepare this matchup.

**Hierarchy and layout:** matchup selector/board; personal evidence; community comparison; active-deck comparison; related replay evidence; action footer.

**Components:** matchup row, source-labelled metrics, deck comparison table, prep preview, replay links, refresh-community status.

**States and help:** no active deck, no personal data, community offline/empty, no replay evidence, low sample. Each missing input removes only its section rather than invalidating the lab.

**Moves:** keep as a cross-feature destination under Prepare. Avoid duplicating full Stats/Community screens; show concise evidence and deep links.

**Untouched:** current matching, community aggregation, deck comparison construction and navigation focus IDs.

## 14. Scorepad

**Purpose:** score or quick-log table matches and pass them through the same safe review/save process.

**Primary action:** Save to review.

**Hierarchy and layout:** mode toggle; match metadata; game score cards; summary; Phone Scorepad connection in a secondary panel.

**Components:** live/quick toggle, format, opponent/legend/deck/event/round fields, BO1/BO3 game cards, score steppers, seat/battlefield inputs, phone QR/inbox status.

**States and help:** unlinked phone, no queued logs, import progress, invalid/duplicate phone entry, network unavailable while desktop Scorepad remains usable, public community upload disabled notice.

**Moves:** Scorepad moves into a collapsed Community submenu while remaining cross-linked from Home and Match history empty state. This is presentation placement only; the current view, phone workflow and persistence path remain unchanged.

**Untouched:** draft source, compatibility fields, phone secret/inbox/ack, result review, local storage and exclusion from public community stats.

## 15. Community Meta and Decks

**Purpose:** explore public, user-submitted trends while keeping provenance and sample size visible.

**Primary actions:** Refresh; contextual Open deck/Study matchup.

**Hierarchy and layout:** Community secondary nav; persistent season/format/source summary; Meta tabs (Legend, Matrix, Recent); separate Decks tab with legend/list drilldown.

**Components:** provenance badge, filters, meta table, matrix plus accessible table, recent list, deck groups, snapshot popup, card/battlefield inclusion sections.

**States and help:** remote loading, disconnected/cache state, no public rows, filtered empty, invalid/missing snapshot, local fallback provenance explicitly labelled.

**Moves:** Meta & Matrix and Community Decks become secondary siblings under Community rather than separate primary sidebar peers.

**Untouched:** community privacy boundaries, caches, aggregation, season definitions, filters and public-only deck data.

## 16. Find a match and Teams

**Purpose:** create/join a temporary LFG room or participate in a durable public team.

**Primary actions:** Post LFG room; contextually Create/join/manage team.

**Hierarchy and layout:** separate Find a match and Teams subsections. LFG starts with listings and a compact post form; Teams starts with directory/membership then selected team detail.

**Components:** account requirement banner, LFG card, create form, accept/close actions, team card/profile, applications, members/messages, match sync, permission-aware actions.

**States and help:** account/profile required, expired room, listing conflict, network error, application status, permission denial. LFG diagnostics are hidden under Support details.

**Moves:** split the current combined `SocialHubView` presentation into two secondary destinations while reusing its state/actions.

**Untouched:** room codes, expiry, formats/preferences, accept/close, account identity, team data/permissions and sync boundaries.

## 17. Private Hubs

**Purpose:** collaborate privately, manage membership, send selected results, and diagnose account/Discord/replay delivery for an exact hub.

**Primary action:** context-specific Join/Create when empty; otherwise Open selected hub. Administrative actions remain permission-dependent.

**Hierarchy and layout:** hub list/invite inbox; selected hub Overview; tabs for Feed, Matches & stats, Members, Integrations/Health, Admin tools when permitted.

**Components:** hub row, role badge, exact ID copy, invite inbox, health summary, sync action, member/role list, feed/messages, stats/matrix, health detail.

**States and help:** legacy hub claim, account/profile incomplete, member/co-owner/owner capabilities, reports channel missing, Discord unverified, replay delivery failed, hub sync partial failure, invite expired.

**Moves:** Hub Health becomes a clear Integrations/Health tab with normal-language summary first and technical identifiers under Details.

**Untouched:** legacy name/password compatibility, exact hub IDs, capability model, owner/co-owner distinction, membership aliases, invite/role/server checks, hub/private data boundaries, sync and delivery APIs.

## 18. Account & integrations

**Purpose:** show one trustworthy identity state and configure account-bound outcomes.

**Primary action:** Create/sign in, Finish profile, Reconnect, or Verify—exactly one based on the current account state.

**Hierarchy and layout:** canonical account header; connection action banner if needed; integration rows; Profile; Data controls. Integration rows: Account backup, Web Replay, Discord reports, Private Hubs, Phone Scorepad, Stream overlay.

**Components:** account-state banner, connection details disclosure, profile form, integration status row, cloud conflict dialog, Web Replay consent flow, hub destination selector, last-verified timestamps.

**States and help:** local-only, linking, needs-profile, ready, reconnect, verification attention, canonical alias accepted, unrelated identity rejected, cloud remote-copy conflict, offline/last-known status.

**Moves:** basic public profile and integration configuration remain here. “Find players” may move to Community/Teams later. Duplicate Settings Web Replay controls become a read-only summary.

**Untouched:** link polling/exchange, canonical/verified aliases, reconnect/switch/unlink distinctions, profile validation, Web Replay/Discord account-bound consent, cloud generation/restore and local-data preservation.

## 19. Stream overlay

**Purpose:** configure an OBS-ready presentation and copy the correct source once.

**Primary action:** Copy OBS URL.

**Hierarchy and layout:** preview dominates; layout/preset controls adjacent; field visibility below; Source setup panel; Session panel; Advanced outputs disclosure.

**Components:** landscape/portrait preview, preset choices, field switches, URL/status, text-output list, simulator bridge, session reset.

**States and help:** local server starting, output unavailable, copied confirmation with exact label, no matches/active deck, session reset consequence.

**Moves:** Text file outputs and simulator bridge move under Advanced outputs; session quick read remains visible.

**Untouched:** local overlay server, URLs, files, branding rule, option keys, presets, session timestamp and simulator receiver.

## 20. Settings

**Purpose:** configure local application behaviour without mixing identity, normal work, support, and recovery in one grid.

**Primary action:** none for immediate-save settings; explicit Save only for grouped/draft forms. Backup/restore are scoped actions.

**Hierarchy and layout:** left category navigation or sticky section index: General, Match tracking, Local replays, Tools & integrations, Data & storage, Updates & app, Diagnostics & support.

**Components:** setting row with label/consequence/control/status, dependency explanation, category search only if later evidence supports it, local save state, destructive confirmation.

**States and help:** saved/pending/failed adjacent to the row; disabled controls explain prerequisite; settings affecting privacy/storage show consequence; restore/import preserve current confirmation and safety backup.

**Moves:** Web Replay/Discord editing to Account & integrations; basic status/deep link remains. Diagnostics, legal, update, recycle bin and backup get clear categories.

**Untouched:** all setting keys/defaults/migrations, compound save patches, hotkeys, directories, updater, legacy import, recycle-bin and backup/restore semantics.

## 21. Diagnostics & support

**Purpose:** collect useful evidence and recover scoped failures without turning normal product screens into debug tools.

**Primary action:** Create diagnostics bundle. Context-specific actions: Refresh, Open logs/folder, Copy support summary.

**Hierarchy and layout:** current system summary; affected domain tabs (Match tracking, Local replay, Web Replay, Account, Hub/Discord); recent bounded evidence; support actions; raw/advanced details.

**Components:** health summary, diagnostic reference, event mix, last evidence, file paths, bundle result, provider repair deep links.

**States and help:** debug capture off/on, no evidence, bundle success/failure, sensitive-data warning, exact location copied/opened.

**Moves:** Capture Lab remains advanced and can be embedded here. LFG diagnostics and force review are not permanently visible in normal screens.

**Untouched:** diagnostic file formats/paths, bundle contents, capture debug setting, safe URL/privacy redaction and raw-capture support contracts.

## 22. Spotlight

**Purpose:** discover creators, streams, videos, teams and community projects without competing with daily readiness.

**Primary action:** context-specific external link.

**Hierarchy and layout:** featured item, categories, compact media grid, partner/support information. Embedded video/stream loads only on user action.

**Components:** creator/project profile, media preview, external-link confirmation where useful.

**States and help:** remote home config empty/offline uses stable local content; media embed failure offers Open in browser.

**Moves:** most current Home editorial modules consolidate here; Home keeps at most one compact feature.

**Untouched:** existing assets, external URLs, embedded-media partitions and remote configuration.

## Cross-screen state patterns

### Empty state

Use an icon only when meaningful, a direct heading, one explanatory sentence, and one primary next action. Do not put an empty state inside another empty card.

Examples:

- “No matches yet” → Start playing / Open Scorepad.
- “No active deck” → Choose a deck; explicitly state capture still works.
- “No local replays” → Enable recording / Import replay.
- “No Web Replays” → Explain Atlas/account/consent prerequisites.

### Error state

Show:

- what failed;
- what remains safe/available;
- last attempted time;
- Retry or scoped recovery;
- diagnostic reference/details.

Never recommend deleting data, creating a replacement account, resetting a provider partition, or broadening visibility as a generic fix.

### Disconnected state

Use a small global network indicator only when multiple enabled remote functions are affected. Each remote section also describes its local fallback:

- Local matches/decks/replays remain available.
- Community uses labelled cache/local fallback when valid.
- Web Replay offers browser fallback when reachable.
- Account/hub status shows last verified time.

### Loading state

Keep the destination's layout stable. Use skeleton rows for lists only if data is expected quickly; use explicit operation progress for capture, upload, processing, restore and import. Never show an indefinite blank webview without wrapper status.

## Presentation-only prototype

The isolated prototype at `docs/ui-redesign/prototypes/riftlite-ui-concepts.html` demonstrates the proposed shell and the required planning screens. It is not imported by the application and has no production data, APIs, Electron calls, or persistence.
