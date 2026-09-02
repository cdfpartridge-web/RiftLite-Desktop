# Start here — RiftLite engineering

Last updated: 2026-09-02

This is the shortest safe entry point for a new Codex chat.

## Read in this order

1. [Current handover](./HANDOVER-2026-08-30.md) — current desktop, website, release, and worktree truth.
2. [v0.9.65 release notes](./release-notes-v0.9.65.md) — behavior in the committed/public desktop baseline.
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

Committed baseline: `3b72267` / public v0.9.65

## Three things not to get wrong

1. The desktop working tree contains valuable **uncommitted** Match Review, Deck Insights, Enhanced Insights, sharing, rules, voiceover, and supporting test work. Do not reset, checkout, clean, or overwrite it.
2. The current dirty tree is a v0.9.71 release candidate with Search Rules hidden. The existing local v0.9.70 installer still contains the visible rules drawer and is superseded; it must not be published. Public Windows and macOS remain v0.9.65 until fresh v0.9.71 artifacts are built from immutable committed source.
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
