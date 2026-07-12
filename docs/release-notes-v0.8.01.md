# RiftLite Beta v0.8.01

This hotfix resolves an account-linking failure that could report an account mismatch and then say the secure link had already been consumed.

## Fixed

- Prevented overlapping desktop verification requests from consuming the same one-time account token.
- Made the authenticated Firebase session authoritative when the website status response omits a redundant account ID.
- Preserved strict rejection of genuine account-ID mismatches.
- Added safe same-device recovery within the original account-link verification window.

Existing local matches and linked website data are preserved during this update.
