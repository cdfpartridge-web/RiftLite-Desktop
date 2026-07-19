# Open product and design questions

## Resolved product direction

- **2026-07-17 — Keep marketing on Home.** The dashboard remains a future revenue and discovery surface. The redesign must retain clearly labelled partner/sponsor, creator, video, stream, Discord and RiftLite-support opportunities while placing concise readiness and urgent recovery information alongside them.
- Recommended default: a balanced revenue rail on desktop, with a session-first sponsor strip as the narrow-window order. A revenue-forward hero remains an available campaign treatment for deliberate testing.
- **2026-07-17 — Hide Scorepad under Community.** Scorepad remains a separate existing view and keeps Home/history shortcuts, but its sidebar entry sits inside the collapsed Community menu rather than Play or the always-visible primary list.
- **2026-07-17 — Use selected-legend art on Active deck.** The Home deck card should resolve `SavedDeck.legend` through the existing official image mapping, with a non-art fallback and no new deck-state owner.

These questions do not block the proposal. Recommended defaults are included so a first presentation-only phase can proceed without inventing new product behaviour.

## Decisions needed before implementation

| Priority | Question | Why it matters | Recommended default |
| --- | --- | --- | --- |
| P0 | Should the first implementation be limited to the shell, Home, tokens and shared status/empty components? | This establishes hierarchy with the smallest capture/account/replay risk. | Yes. Keep Play, match review, deck workspace, replay detail, Account mutations and Settings patches unchanged. |
| P0 | Is the five-item primary navigation acceptable: Home, Play, Review, Prepare, Community? | It determines the shell and all later screen placement. | Yes; Account, Stream overlay, Settings and Help are persistent utilities. |
| P0 | Should Local replays and Web replays appear as two tabs under Review → Replays? | Users currently confuse distinct systems; the implementations must still remain separate. | Yes. Use explicit Local/Web labels and independent states. |
| P0 | Where should Scorepad live while retaining Home/history shortcuts? | It is useful but does not need to occupy the primary navigation or the Play surface. | Community collapsed submenu. Preserve the current view and review/storage path. |
| P0 | Can Play remain deliberately always mounted while other screens display? | This is capture/media critical and constrains routing/layout choices. | Yes, treat as a frozen invariant until a dedicated integration test proves another design safe. |
| P0 | What is the authoritative current account wording: exact UID match or verified canonical/alias identity? | Older copy can cause false mismatch guidance and unsafe “new account” suggestions. | Say “verified linked identity”; show exact IDs only in technical details. Code/server verification remains authoritative. |
| P1 | Which Home campaign mix and layout should be the default? | Home is intentionally both an operational surface and future revenue inventory. | Start with the balanced revenue rail: one above-the-fold featured partner plus one manually controlled creator/video/stream/support lane. Test the revenue-forward hero separately; keep expanded content in Spotlight. |
| P1 | Which Play controls must stay one click away? | Too many icon controls compete with the game, but hiding frequent actions hurts players. | Keep provider, Refresh, screenshot and recording/mic status visible; place hard refresh, Atlas Repair and capture details in More unless attention makes them visible. Validate with usage feedback. |
| P1 | Should “Account backup” replace “Device sync” in visible copy? | Current behaviour is generation-based backup/restore, not conventional live bidirectional sync. | Yes: “Account backup,” with “Back up this device” and “Restore from account.” Do not rename persisted settings/API fields. |
| P1 | Should Web Replay configuration have one editing owner? | Account and Settings currently duplicate controls and can present different gating. | Yes. Account & integrations owns editing; Settings shows read-only status and Manage link after parity tests. |
| P1 | Should the current local `username` be renamed in UI? | It is a match identity/fallback, not the public account profile. | Label it “Local player name” and explain precedence; keep the setting key. |
| P1 | Should testing sessions be a persistent Review sub-route or a Match history mode? | It is valuable but used by a minority. | A mode/banner within Match history, with quick resume when active. |
| P1 | Should Teams and Find a match be two Community secondary destinations? | The current combined screen contains two different jobs and additional internal tabs. | Yes, presentation split only; reuse the same service/state owner initially. |
| P1 | How should active deck changes work during an active match? | The deck affects tracker/prep/overlay behavior. | Do not allow a casual global chip click to silently change it mid-match; open the current deck and require explicit change using existing action. |
| P1 | What sample size is sufficient for a Home “useful insight”? | An insight without denominator can mislead competitive decisions. | Require at least five completed matches in the stated slice and always show count; otherwise show a neutral next action, not an insight. Product may choose a different threshold after data review. |
| P2 | Is compact/narrow-window support intended for full Play or mainly the management surfaces? | Provider game canvases may have a practical minimum size. | Fully support navigation, Home, history, Scorepad, Account and Settings; provide a clear minimum-size state for embedded game/full replay where needed. |
| P2 | Should Spotlight remain a secondary destination or only a Home/community module? | It is low frequency but holds useful editorial content displaced from Home. | Keep as Community → Spotlight for now. |
| P2 | Should Account player search move to Community/Teams? | It is discovery, not account configuration. | Keep in Account for the first shell phase; consider moving after usage evidence. |
| P2 | Should Community Meta tabs become separate addressable sub-routes? | Current local state is not restorable/deep-linkable. | Model serializable substate now; defer a real router until shell stability and user need are proven. |
| P2 | Should Deck workspace sections render one at a time instead of smooth-scrolling one long page? | This materially reduces density but changes component mount timing. | Yes in the sensitive deck phase, after notebook/save-state tests; initial nav phase can retain current rendering. |
| P2 | Should manual BO3 repair be visible by default? | It is a recovery tool that can confuse normal users. | Show under selected-row Advanced repair only. |
| P2 | Should raw capture, replay delivery and Hub Health share one diagnostics framework? | They are related but have different scopes and privacy. | Share visual status components only; retain separate service/data models and scoped detail screens. |

## Questions for user research or telemetry

No new telemetry should be added without explicit privacy review and consent. These can be answered through tester interviews, opt-in feedback, or existing privacy-safe product data where available.

1. What percentage of sessions start from Home versus directly returning to Play?
2. How often are screenshot, microphone, hard refresh, Atlas Repair and capture details used?
3. How many users use both Local replays and Web replays, and where do they expect to find each?
4. Which Match history filters are used most often?
5. How often are testing sessions, manual BO3 repair and bulk hub/team sync used?
6. Which Deck sections are revisited most: list, prep, notebook or performance?
7. How often do users operate RiftLite below 1180px or with display scaling above 100%?
8. Where do account users first notice an identity/verification problem: Account, Private Hubs, Web Replay or Discord?
9. Which Home editorial modules lead to meaningful actions versus visual noise?
10. Do creators prefer Watch/Coach/Export presentation modes or a single customizable workspace?

## Content questions

### Replay language

Recommended first-use copy:

- **Local replay:** “Video, keyframes and coaching notes stored on this device.”
- **Web replay:** “An Atlas match reconstructed on RiftLite.com from an account-bound capture.”
- **Raw capture:** technical/support term only.
- **RiftReplay:** legacy third-party integration term only, never a synonym for RiftLite Web Replay.

Confirm whether customer-facing branding should be “Web Replay,” “RiftLite Web Replay,” or “RiftLite Replay.” The recommendation is “Web replays” in navigation and “RiftLite Web Replay” in explanatory copy.

### Provider language

Recommended first-use copy:

- “TCGplayer (TCGA)”;
- “RiftAtlas.”

Compact provider badges can use “TCGA” and “Atlas” after the user has context.

### Account language

Recommended normal states:

- Local only;
- Connecting;
- Finish profile;
- Connected;
- Reconnect;
- Connection needs attention.

Avoid “UID mismatch,” “anonymous identity,” or provider-token language outside technical details.

### Sync language

Every action should name destination and consequence:

- Publish to community;
- Send selected matches to Private Hub;
- Send selected matches to Team;
- Back up this device to account;
- Upload Web Replay;
- Post replay link to Discord reports.

## Technical discovery questions for a future implementation task

1. What is the smallest renderer test harness compatible with the current Vite/Electron setup without broad dependency churn?
2. Can the Play webview instance be asserted through a deterministic test hook without changing its lifecycle?
3. Which startup failures are safe to surface as degraded local mode versus fatal initialization?
4. Can current capture health distinguish `idle` from true `ready`, or does the service contract need a presentation-only derivation from provider/bridge state?
5. Which operation messages have machine-readable status today versus only strings?
6. Can Community loaders expose `loading | ready | empty | failed | cached` without changing payload formats?
7. What is the current canonical service method for account integration readiness so Account, Settings, Social, Hubs and Web Replay do not calculate it differently?
8. Which replay record fields reliably distinguish no media, missing media, raw-only capture, incomplete finalization and recoverable loose file?
9. Can Deck section content remain mounted but visually segmented during the first deck phase to avoid changing autosave/effect timing?
10. Which CSS generations/selectors are unreachable, and how will that be proven before deletion?

## Decisions explicitly deferred

- New state management library.
- New router/deep-link system.
- Renderer/service extraction or `App.tsx` rewrite.
- Replay deletion/retention product policy.
- Offline Web Replay cache.
- Web Replay pagination/server filtering.
- Automated dual-perspective replay combination.
- Public exposure of Vision, local Replay Lab, legacy upload, moderation, or diagnostic tools.
- Changes to account identity, hub roles, Discord workflow, cloud formats, replay privacy, storage, APIs or capture lifecycle.

## Recommended approval sequence

1. Approve or adjust the five-item primary navigation.
2. Approve the Home dashboard content priority.
3. Approve Local/Web replay terminology.
4. Approve Account & integrations as the canonical Web Replay/Discord editing surface.
5. Approve the scoped first implementation slice and its rollback flag.
6. Only then plan sensitive Play/match, deck, replay and account phases independently.
