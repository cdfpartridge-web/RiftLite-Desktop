# Account Cloud Sync Firestore Rule

RiftLite account device sync stores a compressed local backup under:

- `accountSync/{uid}/manifest/current`
- `accountSync/{uid}/chunks/{generationId}-chunk-0000...`

Chunks are immutable and scoped to a unique upload generation. RiftLite writes
and verifies every chunk checksum before conditionally switching the manifest
to that generation, so an interrupted or concurrent upload cannot mix chunks
from two backups. Chunks from the previously referenced generation are removed
only after the manifest switch succeeds.

The desktop app writes directly to Firestore with the signed-in user's Firebase ID token, so Firestore rules must allow the account owner to read and write only their own path.

Add the block from `docs/firestore-account-sync.rules` inside the existing Firestore rules:

```txt
service cloud.firestore {
  match /databases/{database}/documents {
    // existing rules...

    match /accountSync/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Do not replace the full production ruleset from this repo unless the rest of the live rules are checked in here too.
