# Google sign-in and sign-up

Status: D262 workspace support is implemented for review in PR #259 and is not deployed. Google is enabled on staging; production activation is not claimed. D260 preserves verified same-email accounts. D261 implements the owner's popup request after screenshots showed the original app form losing its colors during handoff; the local popup implementation, 79 affected browser checks, lint and typecheck are complete; see progress for the broad run and unchanged one-worker follow-up. Historical D260 chooser observations are retained below.

## First release

The account sign-in/sign-up, cafe admin, counter and platform sign-in pages offer **Continue with Google** when enabled. On every page entry they read the no-store `GET /api/account/providers` endpoint. This exposes one availability boolean, requires both configured private credentials and the rollout flag, and does not depend on runtime flags captured in a cached HTML document. The first form waits for that small structural read; a failure shows Retry while keeping email/password usable. Public provider data survives identity changes but is refreshed on entry. Google opens in a separate browser popup (D261); the original form stays mounted and styled. Better Auth owns authorization code exchange, state/nonce validation and its normal session cookie. Only the existing basic identity scopes are requested; no Gmail/Drive API integration and no offline access. The provider's immutable subject identifies the account. Its verified email and name create a normal platform customer; no cafe membership, branch role or customer profile is created at sign-up.

**Owner correction, 2026-11-03 (D260, supersedes D259's no-link rule):** a matching, verified local email can use Google on the existing account. Better Auth's built-in linking is enabled with `requireLocalEmailVerified: true`, `allowDifferentEmails: false`, `trustedProviders: []` and `updateUserInfoOnLink: false`. Google must also verify the email. The existing account ID, password, profile and cafe memberships remain; no second user or automatic access grant. An unverified local email must first sign in with its password and verify the account email, preventing an attacker from pre-registering a victim's address and retaining a password after a Google link.

Before a Google binding is created, the native user-validation hook checks the stored local email and protected-account flags. Temporary-password and actively banned accounts, and platform accounts without configured two-step sign-in, remain refused. D262 allows a verified same-email account with two-step sign-in to link Google as its first factor; no authenticated session survives the callback until its authenticator or backup code is verified. No link/unlink management screen is added.

Returning Google users reuse their account. A new Google account has no local password. Before account deletion, two-step setup, or a password-confirmed privileged action, use the existing **Forgot password** email flow to set one. No password check is weakened. Workspace Google sign-in finishes through the existing admin/counter/platform access check. Google never adds a role, cafe membership or branch assignment. Google-only users still need a local password before password-confirmed actions or two-step setup.

The installed Better Auth 1.7.7 twoFactor plugin challenges credential sign-ins by default. D262 extends its public after-hook matcher to the Google callback and uses its unchanged challenge handler: it removes the provisional session, replaces its cookies with a 10-minute challenge and retains its attempt limits and verification endpoints. A following hook returns bounded challenge metadata through the validated callback. The original form displays the shared authenticator/backup-code step. Temporary passwords and platform accounts without configured two-step sign-in still use password sign-in first. The native admin plugin still enforces bans. Google provider ID-token sign-in is disabled: only the state-bound redirect flow is supported.

The popup callback lands on `/google-callback?google=1&googlePopup=<attempt>`, without carrying the parent form's return address. This renders a passive return message without mounting the sign-in/session flow. The callback sends only completion metadata over a same-origin, per-attempt BroadcastChannel. The originating form validates its origin, callback marker and attempt ID, then either shows the pending authenticator step without announcing login, or verifies a fresh non-guest session and announces its identity through the shared boundary before checking the initiating workspace. The workspace retains its own safe redirect and refusal behavior. Valid sign-in to another workspace still refreshes the identity in other tabs. The marker identifies an attempt, grants no authentication and carries no credentials. The existing non-popup callback remains compatible. OAuth initiation never announces login. Errors use fixed local copy, never Google's raw error description. Cancel, missing/mismatched/replayed state, disabled provider, and an unverified-account conflict issue no new session. A guest's orders move through the existing anonymous plugin's `onLinkAccount`; no custom order migration.

Google access, refresh and ID tokens are cleared before account insertion/update. No account token cookie is enabled. Google profile photos are not imported; the app keeps its existing same-origin CSP. No Google browser SDK, new dependency or schema migration. Only `/sign-in`, `/sign-up`, `/c/<slug>/admin/login`, `/c/<slug>/counter/sign-in` and `/platform/sign-in` use `Cross-Origin-Opener-Policy: same-origin-allow-popups`; the passive `/google-callback` uses `unsafe-none` and no-store so the callback can finish without enforcing a new isolated opener group; all other routes retain `same-origin`. The provider destination is restricted to Google. Completion uses only bounded metadata on a same-origin per-attempt BroadcastChannel; it never relies on reading the returned popup document. The popup closes itself after receipt is acknowledged.

## Google setup

Create a **Web application** OAuth client in [Google Cloud Console](https://console.cloud.google.com/auth/clients). Configure the Google Auth Platform branding, audience and requested basic identity scopes. Use the app's real brand (Angder), support email and appropriate published homepage/privacy/terms links. In Testing mode, explicitly add the Google accounts used for testing. Publish the consent app as appropriate before a public release.

Register exact redirect URIs (no trailing slash):

| Environment | Redirect URI |
|---|---|
| Local | `http://localhost:3000/api/auth/callback/google` |
| Staging | `https://staging.angder.app/api/auth/callback/google` |
| Production | `https://angder.app/api/auth/callback/google` |

Prefer separate local/staging and production clients to isolate credentials. Google Cloud project management is still required even though the application is hosted on Cloudflare.

| Setting | Value / location |
|---|---|
| `NUXT_GOOGLE_AUTH_CLIENT_ID` | The environment's OAuth client ID; private runtime config / Worker secret |
| `NUXT_GOOGLE_AUTH_CLIENT_SECRET` | Its client secret; private runtime config / Worker secret |
| `NUXT_PUBLIC_GOOGLE_AUTH_ENABLED` | `true` only after credentials and callbacks are ready; defaults to `false` |
| `NUXT_PUBLIC_SITE_URL` | Existing exact environment URL; keep unchanged |

For local development use git-ignored `.env`. For deployed environments configure private Worker secrets using the existing operations workflow, never the repository, public runtime config, PR text or chat. Staging now declares its owner-enabled public flag in the staging Nuxt/Worker configuration so redeploys preserve it. Both private credentials are still required by the server. Production remains off by default and needs its own reviewed activation. No secret value belongs in a screenshot. Both the private credentials and the enabled flag are required by the server. A modified public flag cannot enable an unconfigured provider.

Do not add wildcard callbacks or trusted origins. Staging remains behind Cloudflare Access: the test browser must hold its Access session when returning from Google. Neither Google nor the callback needs a new WAF/Access bypass.

Rollback: set the public flag false and verify both pages hide the option. For staging, also change the declared staging flag and Worker variable to false before redeploy, so a future deploy cannot re-enable it. This also removes the provider server-side. Existing sessions and email/password continue; before disabling an in-use provider, offer Google-only users the existing password-reset path.

## Verification and edge cases

`server/features/identity/tests/google.auth.test.ts` exercises Better Auth's real handler, state, cookies and migration-backed SQLite database with only Google's network boundary mocked. It covers new/returning users, same-email verified-account reuse, unverified local conflicts, explicit linking and protected-account pre-link refusals, unverified Google identity, missing/mismatched/replayed state, consent cancellation, forbidden direct ID-token sign-in and external callbacks, token removal, flags/bans and both-cafe guest-order ownership. Existing auth/tenant/2FA/erasure suites remain part of CI. For guard mutation checks, remove each relevant guard (local-email verification, protected-account pre-link check, different-email restriction, session-create check and verified Google email check) and require its regression to fail before merge.

`test/e2e/google-account.test.ts` covers disabled rollout, fixed callback error copy, preserved return links, popup success/cancel/error/retry/timeout, blocked popups, mismatched attempts, unmount cleanup, callback security headers, and six-width light/dark form styling. `app/features/account/tests/google-popup.test.ts` exercises real Vue scope/identity cleanup during held initiation and final session reads, callback origin/path/attempt checks, and rejection of a guest session. These checks do not prove Google's network or browser flow. Changed feature checks: this file and `test/e2e/shop-account.test.ts`; the full CI e2e suite must also pass.

The resumed environment can run local checks with Node 24.22.1 and Corepack pnpm 12.15.0. The Google server fixture explicitly sets `advanced.disableOriginCheck: false` and `disableCSRFCheck: false`: Better Auth 1.7.7 otherwise skips origin validation in test mode. This is test configuration only, not a change to production authentication. HTTP tests cover all three callback fields and cookie-bearing untrusted origins. D259 Google server tests passed (17/17); mutation checks detect removal of protected-session, verified-email and callback-origin protections (D259); D260 adds linking safeguards. See the latest [progress entry](../progress.md#google-account-integration-d259-2026-11-03) for full-suite and CI evidence. Real Google staging and enabled-button visual checks remain pending.

Before enabling staging, manually verify:
- Both pages at 320, 390, 768, 1024, 1440 and 844×390, light/dark; keyboard navigation and disabled/double-click state.
- New Google identity, returning identity, consent cancellation and Google denial; real callback URI, cookies and HTTPS.
- A verified same-email password account reuses its ID and keeps its password, name, orders, points and memberships. An unverified local email is refused with a verification instruction; protected accounts still use password/authenticator login.
- Set a password for a Google-created account via Forgot password; two-step setup and deletion keep their existing checks. Once 2FA is on, Google login is refused and password + code works.
- A guest order becomes visible to the Google account; another guest's orders remain private; cafe/branch access is not added.
- Other tabs clear the old identity on successful callback; initiation/cancel do not announce a login.
- Missing credentials and rollback fail safely; no secret, auth code, token or raw provider description in UI/application logs.

Reference APIs checked against [Better Auth Google](https://better-auth.com/docs/authentication/google), [accounts](https://better-auth.com/docs/concepts/users-accounts), [database hooks](https://better-auth.com/docs/concepts/database), and the [v1.7.7 source](https://github.com/better-auth/better-auth/tree/v1.7.7). In particular `user.validateUserInfo` and the session-create hook use that version's contract.

The button uses the unmodified [official Google G asset](https://developers.google.com/static/identity/images/g-logo.png), downloaded from Google's [branding guide](https://developers.google.com/identity/branding-guidelines) and served locally as `public/google-g.png`. Its aspect ratio is preserved; no third-party image request is needed. Include the enabled button in the staging visual/branding review before public activation.

## D260 staging feedback and reproduction

Owner reports: sign-in popup breaks page styling; Google disappears after sign-out until a hard reload; same-email rejection differs from the intended product behavior. D260 changes the last behavior, with verified-email safeguards above. Do not label the first two fixed without reproducing them.

Browser regressions mock current server availability as enabled while the document bootstrap flag stays off: real local password sign-in → cafe → sign-out → client-side sign-in checks Google remains available; held OAuth initiation checks stable geometry, disabled double-submit and same-tab navigation at all six review sizes. Provider discovery tests hold the current availability response, change availability across client-side sign-in/sign-up entries and verify it supersedes the disabled bootstrap flag. The existing Browser check suite remains a compatibility check. External Google and Turnstile boundaries are mocked: these are not proof of the owner's real-provider symptom. Initial staging inspection confirmed a styled sign-in page with Google visible after a fresh load and signed-out navigation via `/cafes`; it did not reproduce the reported sign-out path.

Owner clarification: the broken popup is **Google's account chooser**, not the in-app Browser check; the missing-button page retains a normal email/password form. The account chooser itself is outside this app's rendering and is not claimed repaired. Capture the broken chooser/return-page screenshot before changing layout or CSP.

Additional live inspection during D260: the staging Google button navigated to a styled Google sign-in document in the same tab; Back returned to a styled app sign-in page with Google visible. No credential entry, Google-account consent or successful login was performed. The owner's reported chooser styling remains a separate reproduction task.


## Popup handoff (D261, 2026-11-04)

The owner supplied screenshots of the app form losing semantic colors and its submit action during Google initiation, and requested a browser popup from both pages. The original form now stays mounted; the email footer keeps its label and is disabled while Google is pending. No page-level CSS override or provider SDK is added. The callback uses a separate passive `/google-callback` document with COOP `unsafe-none`; returning to a document with `same-origin-allow-popups` severed the handle in the actual Chrome regression. Only the initiating account routes use `same-origin-allow-popups`. All normal routes retain `same-origin`.

Open the popup during the click before awaiting initiation; use Better Auth's [documented `disableRedirect` option](https://better-auth.com/docs/basic-usage). The callback grants no login by itself: the original active scope validates channel origin/callback marker/attempt and reads the actual session. The callback closes its own window after the originating channel acknowledges receipt, because browser opener isolation can detach direct window access. Browser tests mock the Google boundary; staging must still verify real consent, callback cookies and mobile browser popup behavior. No Google OAuth client redirect URI change is needed: the provider still returns to `/api/auth/callback/google`; Better Auth then redirects to the passive page.


### Protected-account callback error casing (2026-11-04)

For an already-linked Google identity later protected by two-step sign-in, a temporary password or superadmin status, the session-create guard throws `GOOGLE_PASSWORD_REQUIRED`. Better Auth v1.7.7 forwards this exact code; pre-link validation returns its lowercase counterpart. Both must map to the same fixed password/two-step instruction. The popup passes only the normalized allowlisted code; raw upstream descriptions remain excluded. Server regression asserts the returning-account code, and browser checks cover both forms and both spellings. [Verification and live limits](../progress.md#google-protected-account-error-repair-d261-2026-11-04).


## Workspace Google sign-in (D262, 2026-11-04)

- Purpose: offer the existing Google popup at all five entry points, including admin, counter and platform, while preserving the account's required second factor and each workspace's access checks.
- Acceptance: disabled/unconfigured Google stays hidden; discovery errors retain password sign-in and Retry; popup cancellation/block/error/timeout keeps the original form; a required authenticator/backup-code step precedes any usable session; final access uses the original workspace endpoint and redirect guard; no new role or membership is granted; wrong-workspace accounts use the existing refusal/sign-out behavior; temporary-password/banned accounts and platform accounts without 2FA remain refused.
- Contract: existing `POST /api/auth/sign-in/social`, `/callback/google`, `/two-factor/verify-totp`, `/two-factor/verify-backup-code` and workspace `GET .../me`; no application route, schema, migration, dependency or provider credential change. The passive callback adds only `googleTwoFactor=1` metadata to its allowlisted status channel. No token crosses windows or enters storage.
- Shared UI: `GoogleSignInButton`, `useAccountProviders`, `useGoogleAuthRequest`, `useGoogleAuthPopup` and the bounded error mapper live at shared roots. Account adapters retain their feature contract; each workspace supplies its existing completion/access check. Forms use the existing task-frame pattern and Nuxt UI defaults at all widths.
- Security choice authorized by the request: Google may replace the password first factor for an already entitled account; configured account 2FA still challenges every Google sign-in. The native plugin owns challenge cookies, verification records, expiry, counters, replay and backup-code consumption. Wrapper behavior is checked against locked Better Auth 1.7.7 and must be rechecked during upgrades. No internal package paths or copied cryptography.
- Verification: migration-backed tests check first linking and returning customer/platform identities, no usable session before the code, wrong code, successful TOTP, backup code and replay. Removing the Google challenge matcher must fail on a live session being returned. Browser regressions cover all entry points, workspace completion/refusal, pending 2FA, cancel/retry and six-width styling. Existing cross-tab, permissions, temporary-password and two-factor suites remain required.
- Known existing limit: guest-order transfer does not run after a two-factor challenge; this matches password plus 2FA and is not changed here.
- Rollout: same Google credentials, availability flag and provider callback URI. No deployment/production activation is authorized by these changes. [Current evidence](../progress.md#google-workspace-sign-in-d262-2026-11-04).


### Google entry document policy (D261, 2026-11-05)

COOP belongs to the loaded document, not the current router URL. Entering any of the five Google sign-in/sign-up routes from a non-entry page performs a full local document navigation before the form mounts, preserving the destination query and fragment and honoring the leave guard. This installs the existing popup-compatible header. Direct loads/hydration of the entry document and transitions between the entry forms need no extra navigation; a redirect from a protected document during hydration still loads the entry document. Other documents keep strict `same-origin`; the callback keeps its existing `unsafe-none` and no-store rules. Test from the menu through the real Sign in/Create an account links and from protected workspace redirects, then cross the provider origin and assert both completion and actual popup closure. A direct-entry-only test misses the inherited-policy failure.
