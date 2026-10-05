# Past replay visibility — 5 October 2026

Local changes only, version 0.9.80 unchanged. Earlier Known opponent hand and card-catalog changes are preserved. No installer, deployment, version bump or production mutation was requested or performed.

## Cause and user flow

The desktop's embedded My replays library signs in through an HttpOnly account cookie. The website showed its existing visibility control only to a Firebase browser user, while the visibility PATCH endpoint accepted bearer tokens only. The desktop account was therefore able to list its games but had no working way to change their visibility. The desktop Recording & sharing control changes future defaults only.

The current public-version workaround is to open https://www.riftlite.com/replays?scope=mine in a browser, sign in with the owning account, and use the replay's existing visibility dropdown.

This update adds:

- A highlighted **Change visibility** action beside Watch replay in a game's summary and Replay & video panel, including account-owned cloud games without local capture files.
- An authenticated replay management entry at `/replays/<id>?embed=1&manage=visibility`. This opens the website editor; merely opening it does not change visibility or reupload the game.
- Clear Public, Unlisted and Private choices with explicit Save/Cancel and server-confirmed success. My replays cards expose the same editor. Website ownership checks remain authoritative.
- A **Change a past replay's visibility** link from Recording & sharing to My replays, and a clearer label for the separate future-upload default.

The companion website checkout is `../opening-turns-lab-20260923`. Its receipt records cookie-authenticated PATCH, same-origin protection, owner-only metadata loading and website checks.

## Completed uploads and Discord

The delivery queue previously selected healthy completed replays whenever their cached visibility differed from the current future default. It could consequently rewrite a past replay in the background. Completed captures now keep their prior choice. Only an explicit failed visibility operation has a persisted retry target (`pendingVisibility`); legacy failure receipts migrate without requiring a fresh upload.

Automatic Discord requests now identify themselves. The website preserves Public/Unlisted and stops an automatic post if the owner has made that replay Private; the desktop persists that stop across restarts. Explicit one-game Share to Discord retains its existing consent flow.

Deploy the accompanying website support before releasing this desktop update. Older websites reject the new automatic flag safely; the desktop must not strip it and retry. Older desktop versions lack this distinction and need the update for the complete background-delivery fix.

Existing edge: a genuinely failed visibility-completion PATCH intentionally retains its exact pending target. A later independent website change cannot supersede that operation reliably without server-side revision tracking. This is separate from the now-disabled blanket rewriting of healthy completed replays.

## Validation

- Desktop release gate: TypeScript, 82 account-sync checks, and **238 files / 2,591 tests passed**.
- Clean Electron, game-preload and renderer production build passed; only the existing renderer chunk-size advisory remains.
- Focused cases cover cloud-only management, unsupported URLs, completed-upload defaults, foreground retry, persisted and legacy pending targets, Discord privacy stops, and explicit sharing compatibility.
- Browser QA used the actual website components with synthetic local data and mocked authentication/API: Public and Unlisted saves confirmed; the editor scrolls to its actions at 390 × 600. No real replay was changed. Evidence is in the website checkout's ignored `output/playwright/visibility-preview/`.
- Local build evidence is in `output/replay-visibility-20261005/`; the existing installer predates these changes.
