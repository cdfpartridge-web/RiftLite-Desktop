# RiftLite agent entry point

- Read [`docs/START_HERE.md`](docs/START_HERE.md) before changing this repository.
- Run the read-only handover snapshot it references, then inspect `git status`.
- Preserve all existing dirty and untracked files. Never reset, clean, discard, or broadly overwrite work unless the user explicitly requests it.
- Stage explicit intended paths only; never use `git add -A` in this repository.
- Do not publish, deploy, push, tag, change versions, rebuild public artifacts, or mutate production data without explicit user authorization.
- Keep desktop, website, and specialist worktrees separate; confirm the correct path and branch before editing.
