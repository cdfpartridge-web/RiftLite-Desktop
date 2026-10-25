# Atlas All cards discovery without terminal socket fields

## Report and evidence

The 25 October Riven–Kai'Sa BO1 uploaded successfully and was Ready, but All cards stayed disabled. Its installed archive exactly matched the new partial-mulligan local installer. The collector recorded `capture / unavailable` before making an Atlas request.

A read-only audit of that exact capture found 1,100 packets, a valid two-player identity and contiguous authoritative history through sequence 246. A `set_score` action at 10:24:18.793 UTC reached 8–7, followed by a chain action. None of the captured packets contained `gameHistoryEndedAt`, `gameOutcome` or a winner marker. The extractor required those fields and therefore found no eligible target. Neither the website's mulligan update nor an older installed build caused this failure. The score is evidence of the reported ending, not proof authorizing a full-card import.

Sanitized evidence is under `output/atlas-riven-kaisa-20261025/`: `locator.json`, `extractor-guards.json` and `ending-shape.json`. Raw captures, credentials and profile databases have not been copied or changed.

## Correction

For an exact captured BO1 whose ending fields are absent, retain a completion-check candidate without inventing an end timestamp or winner. Existing explicit-completion and BO3 rules remain in place. A fallback candidate must wait for a trusted lobby or the exact native replay route; it performs no authentication or replay requests on the game page, and waiting there does not consume retry attempts.

Atlas's official metadata contract identifies a ready replay by its exact game key, final frame index, ownership and permission fields; it does not promise a `completedAt` metadata field. Full import also requires a genuinely completed, matching export. Pending, restricted, mismatched and invalid data remain unavailable. Existing active-game cancellation, account checks, finite retries, sharing controls and unchanged canonical opening remain intact.

The website already supports a completed export aligned to an earlier captured timeline. No website change, desktop version bump, public release, profile reset or production replay rewrite is part of this correction.

## Validation and local build

Completed at 10:47:56 UTC / UK on 25 October. The exact affected capture produced zero targets before the fix and one Atlas-confirmation candidate after it, with no invented ending. The 54 extractor/queue tests and 84 emitted-query tests passed; both original user-supplied Atlas exports passed the new fallback (284 / 329 frames) with mulligan metadata retained. Independent review found no blockers.

Final release gate passed TypeScript, 82 account checks and all 3,137 tests. Production build, Windows artifact verification, isolated packaged startup and exact parity of 365 compiled files / 60 resources passed. The first gate run passed every product test but additionally discovered a diagnostic backup named `*.test.ts`; that backup was renamed to text with its bytes preserved, and the complete gate then passed. The failed receipt remains in `release-gate-first-attempt.log`.

Local installer: `output/installer-atlas-allcards-completion-20261025/RiftLiteBetaInstall.exe`, still v0.9.86, 159,783,243 bytes, SHA256 `b70b3d904fa6eb22e8661ea1b92dd2c77d1ae8f9761ea0c619b7e86d191b1ce7`. Build receipt: `build-evidence.json` in that directory. Only the two collector source files and their tests differ in product sources from the partial-mulligan installer. Existing desktop sources/refs, website refs and original `next-env.d.ts` bytes, public artifacts and older local installers were verified preserved.

The user should fully quit, install this candidate, reopen RiftLite and leave signed-in Atlas at the lobby briefly. The same recent Ready replay can then be retried within the existing six-hour collection window; no new game or website deployment is required to exercise the correction. No installer has been installed by the agent. Atlas availability and the owner's real attachment after restart remain to be tested; do not claim that All cards is already attached to the reported replay.
