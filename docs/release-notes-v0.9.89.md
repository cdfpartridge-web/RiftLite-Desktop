# RiftLite v0.9.89

- Improved Atlas BO3 All cards collection, including native setup frames, deciding games and two-game sweeps where Atlas leaves the series score behind. Each game still requires verified completion, ownership and permitted card access.
- Added bounded retries for eligible recent replays and improved collection diagnostics. Gameplay and navigation interruptions defer collection safely.
- Moved background replay/history/account work behind idle gameplay scheduling and improved renderer performance handling to reduce disruption during matches.
- Simplified Home with one Play action, Community Spotlight first, creator videos second and partners last. Added BMUCasts and EMOEtional to Community Spotlight, and removed the expired Radiance notice and Home filter toolbar.

After updating, fully restart RiftLite and open signed-in Play -> Atlas. After a BO3, return to the lobby to allow collection. Automatic retries cover eligible Ready captures within six hours; older recovery and Atlas private-deck access are not guaranteed. Original captures, Player view, sharing preferences and private review notes remain intact.

The All cards paths passed regression and native-export verification. Live collection after this update still needs confirmation; the underlying cause of the reported transport stalls remains unproven.
