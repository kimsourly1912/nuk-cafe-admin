# Google sign-in and sign-up

Status: implemented behind a disabled-by-default flag on `codex/google-account-auth`. Not deployed or verified with real Google credentials.

## First release

Both platform account pages offer **Continue with Google** when enabled. Google opens in the same tab. Better Auth owns authorization code exchange, state/nonce validation and its normal session cookie. Only the existing basic identity scopes are requested; no Gmail/Drive API integration and no offline access. The provider's immutable subject identifies the account. Its verified email and name create a normal platform customer; no cafe membership, branch role or customer profile is created at sign-up.

**Owner decision, 2026-11-03:** existing email/password accounts keep their current login method. All provider linking is disabled server-side, including direct calls to link-social; a same-email Google attempt fails with `account_not_linked`. No duplicate account is deliberately created and no password account is silently merged. Explicit linking and Google login for existing password accounts are deferred.

Returning Google users reuse their account. A new Google account has no local password. Before account deletion, two-step setup, or a password-confirmed privileged action, use the existing **Forgot password** email flow to set one. No password check is weakened. Workspace sign-in pages remain email/password; a Google-created person granted workspace access must set a password first.

The installed Better Auth 1.7.7 twoFactor plugin challenges credential sign-ins only. A session-create hook refuses OAuth login for a stored account with two-step sign-in enabled, a temporary password, or the superadmin role, before a session is written. Such users use email/password and the existing second-factor step. The native admin plugin still enforces bans. Google provider ID-token sign-in is disabled: only the state-bound redirect flow is supported.

The callback lands on `/sign-in?google=1`, carrying the existing safe `redirect`. That page reads a fresh real session, broadcasts a completed login through the shared identity boundary, then returns to the selected cafe page. OAuth initiation never announces login. Errors use fixed local copy, never Google's raw error description. Cancel, missing/mismatched/replayed state, disabled provider, and an existing-account conflict issue no new session. A guest's orders move through the existing anonymous plugin's `onLinkAccount`; no custom order migration.

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

For local development use git-ignored `.env`. For deployed environments configure private Worker secrets using the existing operations workflow, never the repository, public runtime config, PR text or chat. Configure the public flag using the deployment's runtime variables/configuration and verify it survives the next deployment. No secret value belongs in a screenshot. Both the private credentials and the enabled flag are required by the server. A modified public flag cannot enable an unconfigured provider.

Do not add wildcard callbacks or trusted origins. Staging remains behind Cloudflare Access: the test browser must hold its Access session when returning from Google. Neither Google nor the callback needs a new WAF/Access bypass.

Rollback: set the public flag false and redeploy/verify both pages hide the option. This also removes the provider server-side. Existing sessions and email/password continue; before disabling an in-use provider, offer Google-only users the existing password-reset path.

## Verification and edge cases

`server/features/identity/tests/google.auth.test.ts` exercises Better Auth's real handler, state, cookies and migration-backed SQLite database with only Google's network boundary mocked. It covers new/returning users, same-email verified/unverified credentials, unverified Google identity, missing/mismatched/replayed state, consent cancellation, forbidden direct ID-token sign-in and external callbacks, token removal, flags/bans and both-cafe guest-order ownership. Existing auth/tenant/2FA/erasure suites remain part of CI. For guard mutation checks, remove each relevant guard (linking disabled, session-create check, verified Google email check) and require its regression to fail before merge.

`test/e2e/google-account.test.ts` covers disabled rollout, fixed callback error copy and preserved return links. These checks do not prove Google's network or browser flow. Changed feature checks: this file and `test/e2e/shop-account.test.ts`; the full CI e2e suite must also pass.

Local execution is currently blocked before pnpm starts (Corepack cache EPERM; a writable cache cannot download pnpm due to network EACCES). No passing local checks, guard mutation results, screenshots or real-provider evidence are claimed. Review CI before merging.

Before enabling staging, manually verify:
- Both pages at 320, 390, 768, 1024, 1440 and 844×390, light/dark; keyboard navigation and disabled/double-click state.
- New Google identity, returning identity, consent cancellation and Google denial; real callback URI, cookies and HTTPS.
- Existing same-email password account is refused with useful copy; its password and authenticator login still work.
- Set a password for a Google-created account via Forgot password; two-step setup and deletion keep their existing checks. Once 2FA is on, Google login is refused and password + code works.
- A guest order becomes visible to the Google account; another guest's orders remain private; cafe/branch access is not added.
- Other tabs clear the old identity on successful callback; initiation/cancel do not announce a login.
- Missing credentials and rollback fail safely; no secret, auth code, token or raw provider description in UI/application logs.

Reference APIs checked against [Better Auth Google](https://better-auth.com/docs/authentication/google), [accounts](https://better-auth.com/docs/concepts/users-accounts), [database hooks](https://better-auth.com/docs/concepts/database), and the [v1.7.7 source](https://github.com/better-auth/better-auth/tree/v1.7.7). In particular `user.validateUserInfo` and the session-create hook use that version's contract.

The button uses the unmodified [official Google G asset](https://developers.google.com/static/identity/images/g-logo.png), downloaded from Google's [branding guide](https://developers.google.com/identity/branding-guidelines) and served locally as `public/google-g.png`. Its aspect ratio is preserved; no third-party image request is needed. Include the enabled button in the staging visual/branding review before public activation.
