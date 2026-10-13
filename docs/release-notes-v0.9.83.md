# RiftLite v0.9.83

## Atlas sign-in fix

Fixed sign-in after Rift Atlas moved to its new account system. RiftLite now keeps Atlas's authentication callback inside the app, preventing the `state_mismatch` error caused by the callback opening in an external browser.

Existing accounts, saved sessions, decks, matches and replays are preserved. After updating, start a fresh Atlas sign-in from RiftLite.
