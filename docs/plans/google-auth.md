# Google sign-in and sign-up

Status: PR #255 merged and deployed to staging. The owner configured Google and reported partial real-provider success. D260 revises same-email linking; fresh provider discovery addresses missing Google after navigation; the Google chooser styling symptom remains under investigation. Production activation is not claimed.

## First release

Both platform account pages offer **Continue with Google** when enabled. On every page entry they read the no-store `GET /api/account/providers` endpoint. This exposes one availability boolean, requires both configured private credentials and the rollout flag, and does not depend on runtime flags captured in a cached HTML document. The first form waits for that small structural read; a failure shows Retry while keeping email/password usable. Public provider data survives identity changes but is refreshed on entry. Google opens in the same tab. Better Auth owns authorization code exchange, state/nonce validation and its normal session cookie. Only the existing basic identity scopes are requested; no Gmail/Drive API integration and no offline access. The provider's immutable subject identifies the account. Its verified email and name create a normal platform customer; no cafe membership, branch role or customer profile is created at sign-up.

**Owner correction, 2026-11-03 (D260, supersedes D259's no-link rule):** a matching, verified local email can use Google on the existing account. Better Auth's built-in linking is enabled with `requireLocalEmailVerified: true`, `allowDifferentEmails: false`, `trustedProviders: []` and `updateUserInfoOnLink: false`. Google must also verify the email. The existing account ID, password, profile and cafe memberships remain; no second user or automatic access grant. An unverified local email must first sign in with its password and verify the account email, preventing an attacker from pre-registering a victim's address and retaining a password after a Google link.

Before a Google binding is created, the native user-validation hook checks the stored local email and protected-account flags. Two-step, temporary-password, superadmin and actively banned accounts cannot acquire a new binding through either automatic or explicit linking. The session-create guard still protects existing bindings. No link/unlink management screen is added.

Returning Google users reuse their account. A new Google account has no local password. Before account deletion, two-step setup, or a password-confirmed privileged action, use the existing **Forgot password** email flow to set one. No password check is weakened. Workspace sign-in pages remain email/password; a Google-created person granted workspace access must set a password first.

The installed Better Auth 1.7.7 twoFactor plugin challenges credential sign-ins only. A session-create hook refuses OAuth login for a stored account with two-step sign-in enabled, a temporary password, or the superadmin role, before a session is written. Such users use email/password and the existing second-factor step. The native admin plugin still enforces bans. Google provider ID-token sign-in is disabled: only the state-bound redirect flow is supported.

The callback lands on `/sign-in?google=1`, carrying the existing safe `redirect`. That page reads a fresh real session, broadcasts a completed login through the shared identity boundary, then returns to the selected cafe page. OAuth initiation never announces login. Errors use fixed local copy, never Google's raw error description. Cancel, missing/mismatched/replayed state, disabled provider, and an unverified-account conflict issue no new session. A guest's orders move through the existing anonymous plugin's `onLinkAccount`; no custom order migration.

Google access, refresh and ID tokens are cleared before account insertion/update. No account token cookie is enabled. Google profile photos are not imported; the app keeps its existing same-origin CSP. No Google browser SDK, popup, new dependency or schema migration.

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

`test/e2e/google-account.test.ts` covers disabled rollout, fixed callback error copy and preserved return links. These checks do not prove Google's network or browser flow. Changed feature checks: this file and `test/e2e/shop-account.test.ts`; the full CI e2e suite must also pass.

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
