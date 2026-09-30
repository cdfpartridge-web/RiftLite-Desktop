# Private Team invitations — local implementation

Published in desktop v0.9.79 and the supporting website on 30 September 2026. Both invitation indexes are ready. See [the release receipt](./RELEASE-2026-09-30.md). The original local validation below describes the 29 September checkpoint.

Owners/admins open Community → Teams → their team → **Invite member**. The Members panel accepts a RiftLite handle or creates a single-use link, with Copy link and pending-invite revocation. Targeted invitations appear on the recipient's Teams landing page with Join/Decline. Joining refreshes memberships and opens the team. Private and invite-only teams no longer show ordinary application forms.

The website supports the corresponding authenticated endpoints and explicit account confirmation at `/teams/invite/{inviteId}`. Team membership remains separate from Private Hub membership and Discord verification. Links expire after 14 days and admit one new member. Existing admin roles are preserved, and revoked/used links cannot restore removed members.

Code is in `TeamInvitations.tsx`, `teamInvitationController.ts`, TeamsPanel, shared types, trusted IPC/preload and authenticated FirebaseSync transport. Responses are scoped to the active account/team and ignored after navigation or account changes. Links are constructed on the trusted RiftLite origin from validated invitation IDs.

Validation: all 2,630 desktop tests passed, renderer and Electron TypeScript checks passed, and a Vite production renderer build passed to `output/team-invitations-20260929/renderer`. Real component browser previews used synthetic accounts and the desktop stylesheet. No production messages/data or packaged installer changes occurred.

Release dependency: publish the two additive `teamInvites` Firestore indexes from the website checkout, wait for readiness, deploy the supporting website, then release the desktop changes. The website implementation record is `docs/TEAM-INVITATIONS-2026-09-29.md` in the `opening-turns-lab-20260923` worktree. Preserve all unrelated dirty docs/prototypes and the existing local Hub/Discord fixes.
