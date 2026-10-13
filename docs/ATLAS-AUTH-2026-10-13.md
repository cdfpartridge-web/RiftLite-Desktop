# Atlas account sign-in hotfix — 13 October 2026

The initial local v0.9.82 candidate was confirmed working by the user on 13 October. The fix is now published in v0.9.83 for Windows and both Mac architectures; see [release receipt](./RELEASE-2026-10-13.md). The local-candidate evidence below is retained.

## Cause and change

Atlas replaced its Clerk sign-in UI with its account service. The live Play client starts Google sign-in with `POST /api/auth/sign-in/social`, sets an Atlas-domain state cookie, and navigates to Google. Google's observed return URL is `https://riftatlas.com/api/auth/callback/google`.

RiftLite's previous main-frame and popup navigation policies rejected that root-domain callback and opened it in the system browser. That browser does not have the initiating Atlas state cookie, matching the reported `/auth/error?error=state_mismatch` failure.

`atlasAuthNavigation.ts` now permits the exact HTTPS `riftatlas.com` `/api/auth` and `/auth` route trees in both navigation policies. These are navigation permissions only: no game capture, desktop IPC, clipboard or cross-simulator privileges are added. Existing Atlas partitions, cookies and legacy provider support are retained.

## Validation

- The callback regression failed before the fix; 97 focused checks pass after it.
- TypeScript, 82 account checks and the complete 2,817-test suite pass.
- An isolated Electron 39.8.10 live test reached Google's signed-out form and confirmed its exact Atlas callback. No credentials were entered.
- Four local Electron fixtures verify that old code blocks normal/popup callbacks, while patched code reaches both callbacks with the original state cookie. Popup session sharing and sandbox protections remain intact.
- Production build, Windows artifact verification and isolated packaged startup pass. All 349 compiled files and 60 resources match the fresh build exactly.
- Existing desktop source bytes were unchanged during packaging; existing local/public installer files, Git refs, website sources, `next-env.d.ts` and `tsconfig.tsbuildinfo` were preserved.

The user confirmed successful real-account sign-in with the local candidate before authorizing publication.

## Local installer and evidence

- Installer: `output/installer-atlas-auth-20261013-1802/RiftLiteBetaInstall.exe`
- Size: 159,744,680 bytes
- SHA256: `044cfd6fd8e1439f18240a2d95e092f93bcc5c3d406f3b3a2915118c84856b98`
- Build receipt: `output/installer-atlas-auth-20261013-1802/build-evidence.json`
- Electron verification: `output/atlas-auth-20261013/electron-auth-verification.json`
- Public client references: `output/atlas-auth-20261013/reference/evidence.json`

Close RiftLite before installing this candidate, then start a fresh Atlas sign-in attempt. Do not reuse a callback URL from an earlier failed attempt.

## Separate migration follow-up

`atlasHistoryQuery.ts` still requires `window.Clerk.session` for explicit match-deck/history refresh. This is separate from the navigation failure fixed here. Atlas's new client uses `GET https://auth.riftatlas.com/api/auth/get-session` and `POST https://auth.riftatlas.com/api/auth/token` with credentials included. Any migration must retain the existing account-switch, credential-boundary and response-size protections and needs its own tests.
