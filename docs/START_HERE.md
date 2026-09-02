# Start here — RiftLite engineering

Last updated: 2026-09-02

This is the shortest safe entry point for a new Codex chat.

## Read in this order

1. [Current handover](./HANDOVER-2026-08-30.md) — current desktop, website, release, and worktree truth.
2. [v0.9.71 release notes](./release-notes-v0.9.71.md) — behavior in the current public desktop release.
3. [Web Replay system handover](./WEB_REPLAY_SYSTEM_HANDOVER.md) — only when working on Web Replays, raw capture, or replay upload/delivery.
4. [Long-form engineering history](./CURRENT_STATE.md) — historical architecture and release history; its older status sections are not current operational truth.

Task-specific references:

- [Account onboarding](./account-onboarding.md) and [account cloud sync](./account-cloud-sync.md)
- [Replay V2 desktop](./replay-v2-desktop.md), [Web Replay system](./WEB_REPLAY_SYSTEM_HANDOVER.md), and [TCGA Web Replay monitor](./TCGA_WEB_REPLAY_MONITOR.md)

## Active desktop repository

```text
C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06
```

Branch: `hotfix/atlas-shell-recovery`

Release source: `459c334` / public v0.9.71

## Three things not to get wrong

1. The v0.9.71 source is committed and published. Five known untracked entries remain: three historical v0.9.70 documents, `tmp-app-diff.txt`, and `tmp/`. Do not reset, checkout, clean, publish, or overwrite them casually; `tmp/` may contain sensitive browser state.
2. Search Rules is hidden in v0.9.71 behind a disabled release flag while its implementation remains preserved. Windows `v0.9.71` and macOS `mac-v0.9.71` are public from immutable source commit `459c334`; the superseded local v0.9.70 materials must never be uploaded as current.
3. The website worktree is clean at live commit `135d239`, including sideboard-choice recovery and X0TCG's YouTube rotation. The older primary website checkout is still not the right place to resume replay work without first synchronising it.

## Verify the handover has not drifted

From the active desktop repository, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\print-handover-state.ps1
```

The script is read-only. It prints the current desktop branch, commit, dirty files, package version, local installer hash, relevant website worktree state, and common development ports.

If its output differs materially from `docs/HANDOVER-2026-08-30.md`, trust the live repository state and update the handover before continuing.

## New-chat prompt

> Continue the RiftLite work from `C:\Users\cdfpa\OneDrive\Documents\Claude\Projects\Riftlite Beta 0.6\desktop-v06\docs\START_HERE.md`. Read it and the linked current handover completely, run the read-only handover snapshot script, and inspect Git status before editing. Preserve all existing dirty files. Do not publish, deploy, tag, clean, reset, or bump versions unless I explicitly ask. Summarize the current local/public state, then continue with my request.
