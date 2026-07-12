# RiftLite Beta 0.7.94

This release makes RiftLite account setup and private-hub onboarding substantially simpler while preserving existing accounts and local data.

## Account and hub improvements

- Clear local-only, linking, profile-completion, ready, and reconnect account states.
- One guided Google/email flow shared by desktop linking, private-hub invites, Discord verification, Find Match, and team tools.
- Required player display name and unique handle before account-only social actions.
- Automatic continuation after signup: link the desktop, accept the invite, or finish Discord verification without navigating between pages manually.
- New RiftLite.com Account and My Hubs pages with roles, exact hub IDs, and Open in RiftLite links.
- Website hub memberships refresh automatically into the desktop app.

## Compatibility and identity repair

- Existing accounts, local matches, hub roles, replay ownership, Discord links, and cloud backups remain attached when desktop and website identities differ.
- Existing cloud backups are never silently overwritten during identity association.
- Generated `Player#...` placeholders and email addresses are no longer treated as completed social names.
- Hub member lists, match feeds, and Discord reports use the current canonical account name.
- Legacy hub name/password joining remains available.

## Also included

- All replay, capture-association, mulligan-animation, token-art, account-sync integrity, and Atlas deduplication fixes from the current RiftLite 0.7 release line.
