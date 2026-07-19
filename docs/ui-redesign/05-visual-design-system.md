# Visual design system direction

Status: design proposal only. Token names are illustrative and do not require replacing current CSS in one change.

## Design character

RiftLite should feel like a precise game companion: calm while play is healthy, explicit when an action needs attention, and dense only where analysis genuinely requires it. The visual language should be dark, restrained, and information-led rather than neon or dashboard-like.

Key characteristics:

- neutral dark surfaces with one cool brand accent;
- clear typographic hierarchy instead of multiple borders and glows;
- quiet containers and strong spacing;
- semantic status color used sparingly and always paired with text/icon;
- specialist data views that remain readable at normal scaling;
- game art and replay media provide visual richness; application chrome does not compete with them.

Avoid:

- gradients on most buttons, cards, headers, or active states;
- ambient glow as a default focus or selection treatment;
- 9–11px essential text;
- stacked cards inside cards;
- a border around every grouping;
- multiple disconnected summary boxes for one workflow;
- uppercase tracking labels used as primary navigation;
- every action in a row receiving equal emphasis;
- color-only result, severity, or selection encoding.

## Foundations

### Typography

Use Inter when bundled/available, with the existing system UI fallback. Do not add a network font dependency to the desktop application.

| Role | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Display | 28 / 36 | 650 | Onboarding and rare empty-state hero only |
| Page title | 22 / 30 | 650 | One per screen |
| Section title | 17 / 24 | 650 | Major content sections |
| Component title | 15 / 22 | 600 | Rows, panels, modal groups |
| Body | 14 / 21 | 400 | Default labels and prose |
| Compact body | 13 / 19 | 400/500 | Dense tables and secondary controls |
| Caption | 12 / 17 | 400/500 | Timestamps, provenance, nonessential metadata |
| Metric | 24 / 30 | 650 | A few genuinely important values |

No required or actionable text should be below 12px. Use tabular numerals for scores, dates, durations, percentages and replay time.

Sentence case is the default. Use all caps only for short game-format/status abbreviations such as BO1, BO3, OBS and TCGA.

### Spacing

Use a 4px base:

| Token | Value | Typical use |
| --- | --- | --- |
| `space-1` | 4px | icon/text micro-gap |
| `space-2` | 8px | compact controls, row gap |
| `space-3` | 12px | control groups, table cells |
| `space-4` | 16px | panel padding, form rows |
| `space-5` | 24px | section gap, page gutters |
| `space-6` | 32px | major page rhythm |
| `space-8` | 48px | onboarding/empty state separation |

The default desktop page uses 24px horizontal gutters and 24–32px between major sections. Compact analytics may use 16px section gaps, but not smaller text.

### Shape

- Small controls: 6px radius.
- Buttons, inputs and rows: 8px radius.
- Major bounded surface/modal: 10–12px radius.
- Pills only for compact statuses, formats and filters—not ordinary buttons.
- Borders: 1px, low contrast. Selection uses a clear accent border/background, not a glow.

### Elevation

Use three levels only:

1. base workspace with no shadow;
2. floating menus/drawers with one soft shadow;
3. modal/recovery prompt with stronger shadow and backdrop.

Cards in the normal document flow should not cast shadows.

## Color direction

The values below are starting points for contrast testing, not final production tokens.

| Semantic token | Dark value | Use |
| --- | --- | --- |
| Canvas | `#0B0F15` | application background |
| Sidebar | `#0F141C` | persistent navigation |
| Surface | `#141A23` | bounded panel/modal |
| Raised surface | `#19212C` | selected row, popover |
| Border | `#2A3442` | quiet separators |
| Strong border | `#3B495B` | input/focus adjacency |
| Primary text | `#F2F6FA` | headings/body |
| Secondary text | `#AAB6C4` | descriptions/timestamps |
| Disabled text | `#738091` | disabled only |
| Brand accent | `#36C5E5` | primary selected state/links |
| Brand accent soft | `#153541` | selected/attention-neutral background |
| Success | `#63D39A` | completed/healthy |
| Warning | `#E7B85B` | attention/recoverable |
| Danger | `#F07D87` | failed/destructive |
| Info | `#7DA7F7` | informational/progress |

Guidelines:

- Use brand accent for interactive selection and a small number of primary actions, not every icon/title.
- Use green only for a completed healthy outcome, not generic branding.
- Warning means an outcome needs attention but data is safe; danger means failure or destructive action.
- Win/Loss/Draw use semantic text/badge treatments that also say Win/Loss/Draw.
- Public/Unlisted/Private each include a word and icon; privacy never depends on hue.
- Gradients are limited to game art/media overlays or a restrained one-off brand moment. Navigation, tables, settings and normal cards use flat surfaces.

All token pairs must pass WCAG AA for normal text. Secondary text must pass against every surface where it is used.

## Grid and page layout

### Application shell

- Desktop sidebar: 240px, resizable/collapsible only if state is preserved.
- Compact sidebar: 72px icon rail with accessible tooltip and an explicit expand control.
- Workspace: min width 0, fluid, 24px gutters.
- Comfortable content max width: 1440px for document screens; data tables/Play/replay may use the full workspace.
- Top page header: 64–72px, not visually dominant.

### Common page grids

- Dashboard: 12-column grid; readiness spans 12, next action 7, active deck 5, recent matches 7, activity 5.
- Master/detail: 280–340px list rail plus fluid detail.
- Settings: 220px category rail plus 680–860px content column; avoid a full-width two-column card mosaic.
- Forms: label and control in a one-column flow by default; use two columns only for tightly related short fields.
- Analytics: full-width filter summary, then matrix/chart/table with a side drilldown only at wide widths.
- Play: dedicated immersive layout, no max width.

### Breakpoints

| Width | Behaviour |
| --- | --- |
| 1440+ | Full sidebar and multi-column workspaces |
| 1180–1439 | Full or user-collapsed sidebar; reduce optional side panels |
| 900–1179 | Icon rail, secondary horizontal nav, most grids become one/two columns |
| 600–899 | Bottom primary navigation, labelled More sheet, one-column document pages |
| under 600 | Supported for settings/status/Scorepad where practical; embedded game and full replay player may show a minimum-size explanation rather than unusable controls |

The current behaviour that hides all navigation below 900px should not be retained.

## Core components

### Navigation

- `PrimaryNavItem`: icon + label; selected state uses soft accent background and 3px leading indicator.
- `SecondaryNav`: labelled tabs or links under the page header; native button/link semantics with `aria-current` or `aria-selected`.
- `UtilityNav`: Account, Stream overlay, Settings, Help; never icon-only without tooltip/accessible name.
- `ActiveDeckChip`: deck legend/title and active state; opens deck overview.
- `GlobalHealth`: icon + concise label in expanded sidebar; opens status panel.

Navigation selection should not rely on a gradient or glow. Focus and selection are distinct states.

### Page header

Contains:

- optional breadcrumb/parent label;
- one page title;
- one short description when useful;
- one primary action or a compact action menu;
- contextual status only if it affects the whole page.

Do not repeat the same title inside the first card.

### Sections and surfaces

- Use whitespace, headings and dividers for most document structure.
- Use a bounded surface only for interactive content that benefits from containment: active-deck summary, status/recovery banner, selected replay, form group, modal.
- Never nest more than one bounded surface level. A table/list row is not a card by default.
- Specialized media/game stages may use their own dark canvas.

### Buttons

| Variant | Use |
| --- | --- |
| Primary | One next action per region: Save match, Start playing, Import deck, Copy OBS URL |
| Secondary | Alternative action: Open folder, Retry, Export |
| Ghost | Low-emphasis contextual action, table row menu |
| Destructive | Delete/purge/unlink where the consequence is destructive or security-sensitive |
| Icon | Frequent compact action with required accessible label/tooltip |

Rules:

- 36px default height; 32px compact table controls; 44px touch/narrow mode.
- Loading replaces the leading icon and disables only the affected action.
- Disabled buttons include visible prerequisite copy or an accessible description.
- Destructive actions are separated spatially; they are not styled as ordinary secondary actions.
- Confirmation dialogs state the affected object and what remains recoverable.

### Forms

- Visible labels are mandatory; placeholders are examples, not labels.
- Helper text describes consequence, format, or privacy—not restating the label.
- Validation appears below the field and at the modal/form summary when save is blocked.
- Toggle rows contain label, one-sentence consequence and control; dependencies are explicit.
- Immediate-save settings show Saved/Failed next to the row.
- Compound settings such as Web Replay consent remain one service action presented as one transaction.
- Use progressive disclosure for advanced filters and diagnostics, not for required fields.

### Tables and lists

- Quiet horizontal dividers; no full cell grid.
- Sticky header only when the list scrolls inside a deliberately bounded region.
- Left-align labels, right-align numeric values, use tabular numerals.
- Each row has one primary click target plus a labelled overflow menu; avoid several small same-weight buttons.
- Selected rows reveal a contextual action bar.
- Narrow mode converts suitable tables to labelled rows; large matrices may use contained horizontal scrolling plus an accessible table alternative.

### Metrics and insights

- Use no more than four top metrics on analytical screens.
- Every rate shows its sample/count nearby.
- Metrics that are actionable behave as buttons/links with a clear focus state.
- Insights are sentences tied to evidence, not invented scores or qualitative grades.
- Personal and community data always display a source label.

### Status

Use one shared model:

| Severity | Icon | Example language |
| --- | --- | --- |
| Neutral | circle/info | “Local recording is off” |
| Working | spinner/progress | “Uploading Web Replay” |
| Healthy | check | “Tracking ready” |
| Attention | triangle | “Account verification needed for Web Replay” |
| Failed | alert circle | “Replay file could not be found” |
| Unavailable | offline | “Community data is offline; local stats still work” |

Status components:

- `StatusDot` for terse lists, always with visible text;
- `StatusRow` for settings/integrations, with action and timestamp;
- `StatusBanner` for page-level attention;
- `DeliveryStages` for replay capture/result/upload/process/Discord progression;
- `OperationFeedback` for progress/success/failure near the initiating action.

Do not render every feedback message with a success check. Failure, warning and progress require their own semantics.

### Notifications and activity

- Toasts confirm lightweight completed actions and disappear after a reasonable interval; errors remain until dismissed or resolved.
- A small activity drawer may retain recent replay uploads, sync attempts, exports and updates during the session.
- Notifications name object and result: “Akali vs Annie Web Replay is ready,” not “Upload complete.”
- Clicking a notification deep-links using existing match/replay/hub IDs.
- Match review remains a modal/event, not a toast.

### Empty states

Structure:

1. direct heading;
2. one sentence describing how data appears;
3. one primary action;
4. optional secondary link.

No illustration is required. If artwork is used, it must not push the action below the first viewport.

### Modals and drawers

- Modal for interruptive confirmation/editing: Match review, cloud conflict, destructive actions.
- Drawer for contextual detail that should not lose the current list: filters, status details, replay/hub diagnostics.
- Popover for small menus and selection only.
- Escape closes non-destructive overlays; unsaved/dangerous state asks before dismissal.
- Initial focus, focus trap, return focus and accessible name are required.

The Match review modal may be wide at desktop because BO3 child games are relational. At narrow width, its sections stack; the Save footer remains visible without covering content.

### Icons

- Continue using Lucide for application chrome.
- Use one icon per action/status; avoid decorative icon clusters.
- Icon-only buttons are limited to high-frequency, conventional actions such as Refresh and Close and require labels/tooltips.
- Provider, privacy and replay-type icons must also include text at first use.
- Do not use custom artwork as a substitute for a familiar control icon.

## Domain-specific components

### Tracking readiness strip

Four compact, labelled segments:

1. Provider;
2. Match tracking;
3. Active deck;
4. Replay outcomes.

It summarizes existing state only. Expanding it shows recording/Web Replay/account details and the exact recovery action.

### Match artifact indicator

On match rows, show independent availability:

- Local replay: Ready / Missing / None;
- Web replay: Ready / Processing / Failed / Off.

These are not combined into one generic replay icon.

### Replay delivery stages

Use the existing semantic stages:

Capture → Result → Upload → Process → Discord

Completed stages use check + label; current stage uses progress; skipped/disabled stages say Off/Not selected; failure attaches to the exact stage. Never imply Discord is required for a Web Replay to be successful.

### Account state header

Shows one of:

- Local only;
- Linking;
- Finish profile;
- Connected;
- Reconnect;
- Connection needs attention.

Normal presentation uses handle/display name. Canonical UID, aliases and migration state live in expanded technical details.

### Data provenance badge

Use on Stats, Matchup Lab, Community, hub/team stats:

- My local matches;
- Scorepad;
- Public community data;
- Private Hub: [name];
- Team: [name];
- Cached as of [time].

This prevents empty/fallback/cached community data from looking like a live full dataset.

## Motion

- 120–180ms for menu, tab and selection transitions.
- No looping glow/pulse for healthy idle state.
- Progress spinners only while an operation is active.
- Honor `prefers-reduced-motion`; remove smooth scrolling and nonessential transitions.
- Game/replay semantic animation is a separate protected domain and is not governed by ordinary shell motion tokens.

## Accessibility requirements

- WCAG 2.2 AA target for the shell and normal document screens.
- Visible `:focus-visible` ring on every interactive control; never remove outline without a replacement.
- Keyboard access for primary/secondary navigation, tabs, menus, filters, tables, modal actions and replay controls.
- Correct tab semantics (`role=tablist`, `aria-selected`, related panel) or ordinary link navigation; `data-active` alone is insufficient.
- Status uses icon/text and an appropriate live region for operation changes; avoid announcing high-frequency capture events excessively.
- Minimum pointer target 36px desktop and 44px in narrow/touch layouts.
- Form errors are programmatically associated with fields.
- Dialog focus is trapped and returned to the trigger.
- Matrices, charts and visual deck comparisons provide a table/list alternative and textual summary.
- Media controls are labelled and operable without hover; captions/transcripts are future content concerns, but voice-note controls still need accessible names.
- Zoom to at least 200% should preserve navigation and core settings/review flows. Game surface scaling remains a separate provider control.

## Responsive behaviour by screen type

### Dashboard and document screens

Columns collapse to one; headings/actions wrap; tables become labelled rows when practical. Bottom navigation remains present.

### Play

At compact desktop widths, hide the details drawer by default and keep provider/status controls readable. At widths too small for the provider's game canvas, show a clear minimum-size explanation while preserving access to navigation and recovery.

### Match review

BO3 games stack vertically. The sticky footer contains validation plus Save. Optional fields collapse but never lose entered values.

### Local replay

Library and detail become stacked. Playback remains 16:9; coaching side tools move below or into a drawer. No control should overlay essential transport at small heights.

### Deck prep

Mulligan, Sideboard and Battlefields become a step/tabs pattern, retaining one matchup context and unsaved state.

### Settings/account

Category rail becomes a top select/list; each row stacks label/helper above control. Technical details remain collapsible.

## Visual acceptance checklist

- No essential text below 12px.
- One clear page title and one primary action per region.
- No more than one nested bounded surface.
- Status and action priority remain understandable in grayscale.
- All normal controls have visible hover, focus, active, disabled and loading states.
- Win/Loss/Draw, privacy, health and source states use text plus icon/shape.
- At 900px, users still have persistent labelled or tooltip-supported navigation.
- At 600px, Home, Match history, Scorepad, Account and Settings remain usable.
- Gradients/glows are exceptions, not component defaults.
- Play and replay media remain visually dominant over application chrome.
