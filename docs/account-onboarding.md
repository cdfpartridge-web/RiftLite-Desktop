# RiftLite Account Onboarding

## Product flow

All website account entry points use the same flow:

1. Continue with Google, or expand the email option.
2. Choose a display name and unique handle when the profile is incomplete.
3. Automatically resume ordinary website actions: accept a hub invite, verify Discord, open Find Match, or open team tools.
4. For desktop linking, show the exact website display name, handle, email, and shortened account ID, then require an explicit **Link this desktop** confirmation.

The desktop uses explicit local, linking, needs-profile, ready, and reconnect states. An anonymous Firebase refresh token is infrastructure authentication and must never be presented as a linked RiftLite account.

The desktop is not considered fully connected merely because it holds a refresh token. Its Account page verifies an end-to-end connection contract with the website: the refreshed Firebase UID must exactly match the stored account UID, the website must resolve the same durable Google/email identity, the profile and replay library must be readable, and any account-bound replay-upload consent must name that same UID. Until this succeeds, automatic replay upload remains blocked.

Reconnect and account switch are intentionally different operations. Reconnect sessions are pinned to the stored account UID even if the local token has expired; a browser signed into another account cannot silently replace it. **Switch account safely** first unlinks the device, leaves website replays and backups on the old account, preserves local data, and requires fresh verification and replay-upload opt-in for the new account.

## Identity compatibility

- Firebase UID remains the ownership key.
- `identityAliases/{sourceUid}` records a proven desktop-to-account relationship when an existing provider account uses a different UID.
- Migration is additive and idempotent. Source documents are retained for audit and retry.
- Migration work is committed in bounded write batches without a global record cap. A failed query or write records an attention state instead of falsely marking the migration complete, and the Account page can retry it.
- The stronger hub/team role wins; earliest membership time is retained.
- A complete source profile may be promoted to an incomplete canonical profile, including transactional handle ownership transfer.
- Hub memberships, ownership, inbox items, Discord links, replay ownership indexes, match/message identity snapshots, and account cloud backup are migrated without deleting the source records.
- An existing canonical cloud backup is never overwritten. The legacy source is recorded as a conflict for explicit recovery.

## Display identity

- `Player`, `Player#...`, `Player ...`, email addresses, and RiftLite fallback labels are incomplete identities.
- Email is never used as a social display name.
- New match aggregate writes take display name and handle from the authenticated server profile, not the desktop payload.
- Hub member lists and Discord reports resolve the current profile by UID so historical placeholders stop leaking into current views.
- Profile changes repair denormalized hub, message, match, invite, inbox, aggregate, and Discord link fields.

## Legacy compatibility

- Existing hub name/password joining remains available.
- Existing hub IDs, passwords, roles, invite URLs, local matches, local replays, and settings are retained.
- Existing valid profiles do not need to sign in again.
- Existing incomplete profiles are asked only to choose their RiftLite name.
- Unlink remains local-data-safe and revokes account-bound sync/upload consent.
- Turning off automatic web replay upload does not turn off local raw capture; capture and upload consent remain separate controls.

## Deployment and repair

`scripts/repair-profile-display-names.mjs` remains dry-run by default. Run it without `--apply` first and inspect counts before any production repair. Publishing, installer rebuilds, and production data repair require separate explicit approval.
