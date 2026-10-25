# RiftLite v0.9.88

- Fixed missing All cards games in completed Atlas BO3 replays when Atlas does not send its usual game-ending fields. RiftLite now verifies the completed series and confirms each game directly with Atlas before adding its card data.
- Fixed finished-game snapshots leaving RiftLite thinking a match was still active after returning to the lobby, which prevented automatic All cards collection from starting.
- Original replay captures, opening hands, Player view, sharing preferences and private review notes are preserved.

After updating, fully restart RiftLite and leave Atlas signed in at the lobby briefly. Eligible recent Ready replays can retry collection within the existing six-hour window, subject to Atlas availability and permissions.
