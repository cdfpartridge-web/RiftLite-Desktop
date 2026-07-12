# RiftLite Beta 0.7.96 (Local Build)

This local-only tester build hardens the connection between the desktop account, website identity, private hubs, Discord verification, cloud data, and web replay ownership.

## Account connection

- Desktop linking requires explicit confirmation of the exact website account.
- Reconnect is pinned to the existing account and cannot silently become an account switch.
- The Account page shows verification health, identity, replay destination, migration state, and safe repair/switch actions.
- Automatic replay upload remains blocked until the desktop UID, refreshed token, website account, replay library, and account-bound consent agree.
- Existing local data and website-owned records remain intact when unlinking or switching.

## Compatibility and migration

- Older account associations remain additive, visible, and retryable.
- Migration completion is recorded only after every phase succeeds.
- Turning off automatic web replay upload no longer turns off local replay capture.

The corresponding website endpoints and confirmation UI are live on `https://www.riftlite.com`. This Windows installer was built locally and was not uploaded to GitHub.
