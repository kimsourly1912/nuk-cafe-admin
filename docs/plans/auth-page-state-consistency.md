# Auth page state consistency

Status: all findings implemented locally under D258 and ready for owner review, 2026-11-03. Full browser run: 823/826; after fixing its three failures, all 98 affected tests passed in a fresh build. See the D258 progress row for separate run evidence. The findings below preserve the original audit evidence.

Publishing update (2026-11-03): the owner authorized committing and pushing the reviewed current branch after excluding generated evidence; no PR or deployment requested.

Requested branch: `claude/cafes-page-look`. Preserve its existing uncommitted Your cafes work. The owner explicitly requested the current branch for this audit; do not switch branches, commit unrelated work, push or deploy.

## Scope and evidence

All 15 auth/security route wrappers, their page components, four surface session composables, account actions, route middleware, API/session/data-freshness plugins, task frames and the relevant tests were inspected. Also inspected the root account header, store account header/verification banner, Your cafes and counter branch selection as handoff destinations.

| Routes | Count | Review outcome |
|---|---:|---|
| `/sign-in`, `/sign-up` | 2 | Sticky readiness, arrival-only redirect and silent session-read failure; customer two-factor completion also switches back to the password form |
| `/verify-email`, `/email-verified` | 2 | Loading geometry, incomplete session gates, error rendering and return-context handling |
| `/forgot-password`, `/reset-password` | 2 | Return-context continuity; reset token storage/cleanup; pending operations across identity changes |
| `/c/[slug]/admin/login`, `/c/[slug]/counter/sign-in`, `/platform/sign-in` | 3 | Uneven synchronization, sequential session/refusal reads and competing redirect paths; preserve refused-access policy |
| The three corresponding `change-password` pages | 3 | Keep the existing forced-wording snapshot and saving-through-navigation behavior; check old background reads and redirect ownership |
| Admin/counter `account-security` and `/platform/two-factor` | 3 | Keep the existing component key by user ID and local success updates; synchronization and late-response protection need coverage |

Local browser evidence uses the existing dev server at `http://localhost:3000`, an isolated Playwright browser and mocked auth responses. No real sign-in, sign-up, verification email, password change or account reset was performed. A fake reset-token marker was used for the HTML/state checks. Installed versions checked: Nuxt 4.6.2, Better Auth 1.7.7, `@nuxtjs/better-auth` 0.3.7; Node 24.22.1, pnpm 12.15.0.

Evidence files are local artifacts under `output/playwright/`, not automated regression tests:

- `auth-state-results.json`: delayed successful/expired verification callback, verify-email loading dimensions, failed sign-in session lookup and account invalidation while sign-in stays mounted.
- `auth-handoff-results.json`: password-form reappearance after a correct two-factor response; fake reset marker in the Nuxt HTML payload and retained after leaving the reset page.
- `auth-cross-tab-results.json`: counter account-security remains visible after receiving an auth logout broadcast.
- Corresponding screenshots and probe source files (`auth-*-audit.js.txt`) are beside those results. Only mock identities and a deliberately fake token occur in these probes.

These probes demonstrate frontend behavior, not real-server cookie, authorization or email delivery correctness. This audit did not run the regression suites, production/staging checks, a full accessibility audit or the complete responsive matrix.

## Findings

### F1. Verification renders a provisional result as final — browser confirmed

`app/features/account/components/EmailVerifiedPage.vue` starts with `!failed || account?.emailVerified`, although `useAccountSession()` loads only in the browser. With a successful callback, the message starts as "You can order as soon as the cafe is open" and changes to "You're signed in as Audit User." With `?error=TOKEN_EXPIRED` and an already-verified session, the whole failure page changes to success after the session answers.

Use a session-read gate whenever identity can change the displayed branch or copy. The success/failure body and footer must be chosen together. Preserve existing verified-session recovery behavior; determine it before showing the result. A callback without `error` is not itself a fresh session answer.

### F2. Readiness outlives the answer it describes — browser confirmed for mounted sign-in

`useAccountSession()` and `useCustomerAccount()` keep `known` in separate `useState` keys. Once true it is not generally reset when query data is cleared. Customer identity actions reset only `account:known`, not `account:session-known`. Sign-in and sign-up watch only `known`, with a one-use `arrived` flag.

After a mocked account invalidation changed get-session from signed out to signed in, the session was fetched again but `/sign-in` stayed open with its form. A sticky readiness boolean cannot distinguish an answer for the current identity from one cleared or replaced later.

Define readiness for the current identity and answer, while retaining content during an ordinary same-identity refresh. Reevaluate mounted arrival pages on external identity changes without letting a page's own sign-up/sign-in refresh steal its intended next step.

### F3. Identity changes do not reach every surface — browser and source confirmed

`app/plugins/auth-sync.client.ts` consumes login/logout messages for the admin session only. Only admin `useAuth()` emits `app:auth-changed`; counter/platform actions do not. Customer actions broadcast `invalidate('account')` instead. Their identity changes do not advance the workspace generations used by `createApiFetch`, nor directly clear `cafe:mine`, the platform-team query or workspace `useState` sessions.

A counter account-security page remained visible at its protected URL after an auth logout broadcast. Source review shows the same receiver gap for the platform session. On the customer side, a workspace login/logout does not consistently invalidate account queries in another tab.

Coordinate browser identity changes once across surfaces. Keep surface-specific authorization/session data separate, and never fetch a cafe workspace session from a customer page just to synchronize identity. Broadcast only event metadata, no identity details or secrets. Cover successful and refused sign-in, verification auto-sign-in, sign-out, reset and erasure.

### F4. Session-read errors are presented as signed-out/default state — browser and source confirmed

Both account session composables set `known = true` for query status `error`; their auth page consumers ignore the returned error. A first `/api/auth/get-session` response of 503 produced the normal sign-in form with zero alerts. Verify email can similarly offer sign-in after a failed read. Workspace session `fetchSession()` converts a first network/server failure to a checked null session; `refusedSession()` also catches every failure and returns null. Your cafes waits for the platform-role query but does not render that query's error or the account-session error.

Distinguish confirmed signed out, refused access and unable to check. Provide an error with Retry for the deciding source; do not infer authorization from a failed request. Preserve D241's established refusal/retry behavior and server authorization.

### F5. Verify-email's skeleton does not reserve its final frame — browser confirmed

`VerifyEmailPage.vue` uses a standalone small `UCard` while loading, then replaces it with an `AccountFrame` with an aside. At a 1280px viewport the measured wrapper changed from 208×152 to 672×512; screenshots show the picture panel and footer appearing with the large replacement card.

Use the same task frame, aside, header and footer regions for loading and settled content. Check message-page skeletons as well as form skeletons, in both layouts. Preserve the intended single-card email-verified design; consistency does not require making every page identical.

### F6. Customer two-factor completion reopens the password form — browser confirmed

`SignInPage.vue:onCodeVerified()` sets `codeStep = false` before awaiting `finishSignIn()` and navigation. Holding the final session request after a mocked successful backup-code verification visibly restored Email, Password and Sign in.

Keep the code/success-pending surface locked until finalization and navigation settle. Return to credentials only when the challenge or finalization requires a restart. Workspace sign-in pages already retain the code step during their successful handoff; preserve that behavior.

### F7. Reset tokens enter serialized, long-lived app state — browser confirmed

`ResetPasswordPage.vue` copies the query token into `useState('account:reset-token')` during setup. A deliberately fake marker was present in the server-rendered `__NUXT_DATA__` payload and remained in app state after following Back to sign in. It is explicitly cleared on successful reset only. Query-data clearing in `session-boundary.client.ts` does not clear `useState`.

Move the reset token to page-local client memory, strip it from the URL without destroying the active form, and discard it on departure, terminal failure, success and identity invalidation as appropriate. Verify Back/reload and a second link. Never persist the token or include it in screenshots, logs or test failure artifacts. This finding demonstrates retention in the same-origin page/app; it does not demonstrate another user's access or an external disclosure.

### F8. More than one place can initiate a password-required redirect — source risk, timing reproduction pending

Sign-in pages navigate after successful finalization; `plugins/api.ts` independently watches `mustChangePassword`; middleware then redirects again for password or platform two-factor requirements. This can cause competing navigation and extra intermediate routes. Arriving at workspace sign-in while already signed in also routes through the workspace home rather than consistently retaining the safe original target.

Give successful sign-in one destination calculation with priority: temporary password, required platform two-factor setup, then safe requested destination. Keep the mid-session API watcher for newly reported requirements, with deduplication. Preserve the requested destination through each required step and keep D141's full page loads between cafes.

### F9. Direct session reads and auth completions lack consistent supersession protection — source risk

Workspace `fetchSession()` calls can overlap; they have no per-read sequence check. `apiFetch` guards a changed workspace identity generation, but an older response for the same identity can still restore stale `mustChangePassword` or `twoFactorEnabled` after a successful update. Customer raw `$fetch` session reads, account actions, `useRefusedSession()` reads and auth transport do not all participate in that same lifecycle. An earlier completion can still redirect, set an error or change local UI after a newer operation/account change.

Use deduplication/supersession checks tied to identity and operation. Separate an operation that deliberately changes identity from unrelated work invalidated by that transition, so successful sign-in does not cancel its own completion. Hold old responses across a newer success/account change in tests. Do not report this source risk as a demonstrated server authorization bypass.

### F10. Recovery flows drop return context — source confirmed

Sign-in's Forgot password link, forgot-password's Back links and reset's completion path discard `redirect`. Verify-email's signed-out branch nests only `/verify-email` as the return target and loses its existing cafe redirect. Email-verified uses `home` (cafe menu) instead of the original return target; that existing Back-to-menu behavior is intentional and should remain unless the owner requests a product change.

Carry a validated return target through recovery and nested verification sign-in where currently lost. Keep callback URLs safe, preserve token-entry security headers, and do not permit cross-cafe workspace state reuse. Test a checkout destination, query/hash, no cafe, and hostile redirect values. Do not expand allowable destinations as part of a visual/state fix.

## Proposed implementation order

The owner authorized the full plan on the current branch after reviewing the audit. All five steps are included in this local change; stop for review after verification, without push or deployment.

1. **Make identity transitions consistent (F2/F3/F9).** Add one shared identity lifecycle using Nuxt-managed state and the existing cleanup contract. Surface composables keep their authorization data and public APIs. Synchronize the active tab and other tabs; clear identity-bound data, forms/messages, overlays and mutations before rendering another account, and reject stale completions. Include tests for account A → B and cross-surface logout/login. Resolve the exact shared API in this step's decision/reference updates; prefer installed Nuxt/Better Auth facilities before custom orchestration.
2. **Make customer auth states explicit (F1/F2/F4/F6/F7).** Cover unknown, confirmed signed-out, signed-in, failed session check, submitting, code challenge, finalizing and navigating. Fix verification branch gates, mounted arrival reactions and reset-token lifetime. The page's own action retains control of its next step. A cancelled or failed navigation releases pending state safely.
3. **Make workspace handoffs deterministic (F4/F8/F9).** Apply one redirect priority for admin/counter/console, protect background password/2FA session refreshes and refused-session reads, and keep sessions/drafts from another identity out of security/password forms. Preserve user-keyed security setup and frozen forced-password wording.
4. **Keep layouts stable and return paths continuous (F5/F10).** Reuse task-frame loading regions; reserve structure and actions. Cover Your cafes, root/store account controls and the one-branch counter handoff (currently renders no task frame while redirecting) as destinations. Do not add arbitrary delays, blanket transitions or server rendering of private identity to hide the problem.
5. **Complete regression and visual verification.** Turn the focused probes into maintained tests in the existing suites; update auth/app-behavior/shared-API references, progress, current-state and relevant assistant help. Record actual pass/fail evidence and limitations; stop for review without push/deploy.

## Acceptance and verification

Implementation also guards completion by the page's Vue scope, refreshes same-identity password/two-factor flags across tabs, and enforces D141's document boundary across intervening account routes. The counter's pause-status watcher ignores queue reset during sign-out. Account cleanup awaits deciding account queries once rather than issuing duplicate explicit invalidations.

| Scenario | Required observation |
|---|---|
| Cold SSR/hydration and SPA navigation with deciding reads held | Only the appropriate skeleton/pending frame until the branch is known; no transient wrong form, name, result or action |
| Signed-in arrival at sign-in/sign-up; sign-in in another tab | Safe destination once, without a form flash; mounted pages react; own sign-up still goes to Check your email |
| Successful/expired verification, signed in/out, already verified | Stable final branch; no misleading sign-in action while session is unknown; correct identity after callback and tab return |
| Session 503/offline/timeout and Retry | Error belongs to the deciding read; no false signed-out/refused result; retry keeps the frame stable |
| Password → TOTP/backup code → finalization | Code surface stays pending until handoff; credentials return only on a real restart; duplicate verification prevented |
| Temporary password → password change → platform setup if needed | Priority respected once; original safe destination preserved; no redirect loop or old flag restoring itself |
| Customer/admin/counter/platform A → B; successful/refused sign-in; logout/expiry | Old data, drafts, messages and security setup disappear; all affected tabs recheck the appropriate surface; old responses cannot restore them |
| Password/2FA update with an older session read held | Late answer cannot undo the new flag, reset the setup or send the user back |
| Reset link entry, URL cleanup, failure, success, navigation and Back | Token absent from SSR payload and durable/shared state; only active page can use it; fresh link not confused with old token; failure artifacts contain no secrets |
| Recovery from cafe checkout and verification sign-in | Valid return context survives; external and workspace redirect attacks still rejected |
| Your cafes, root/store headers, one/many counter branches | Consistent identity and loading; no false empty/no-access/Sign in flash; no transient blank branch picker |

Use controlled held responses and DOM observation from before first render; assert forbidden intermediate states, not only final headings. Removing a state gate or stale-response guard must make its regression test fail. Use real-server tests for cookies, verification auto-sign-in, password/reset revocation and two-cafe authorization; mocked browser tests alone do not prove those.

Target suites: `shop-account`, `auth`, `password`, `two-factor`, `session`, `your-cafes`, `cafes`, `counter`, `platform`, `platform-home`, `freshness`, `color-mode` and `accessibility`; add tests to the owning file rather than duplicate whole suites. Before a PR run pnpm lint, typecheck, unit/server tests, audit and relevant e2e; shared lifecycle/frame/plugin changes also require the full local e2e suite. Serialize Nuxt prepare/typecheck/build/dev operations as documented; reuse the owner's dev server without taking it over.

Visual matrix: 320, 390, 768, 1024 and 1440px, landscape 844×390, light/dark, keyboard and reduced motion. Compare loading/settled/pending rectangles and capture handoff frames. Current audit measurements were desktop light mode only.

## Constraints and decisions

- This is a consistency repair under D29 (identity boundary), D97 (account flow), D188/D242/D243 (two-step/security), D238 (first-load structure), D239/D241 (refused access), and D141 (tenant navigation). No new permission, session-duration, verification or recovery policy is selected here.
- Preserve browser-only identity on cached public pages; no session/user data in shared SSR caches. Keep guest order ownership and temporary-password restrictions.
- Preserve current server authorization and mandatory platform 2FA. A platform superadmin never obtains cafe access through synchronization.
- If tests uncover a policy ambiguity (for example which identity a recovery link is supposed to leave signed in), record it and defer that behavior for the owner. Independent loading/synchronization fixes can continue.
- The implemented shared API and its constraints are recorded in D258 and the decision index; verification evidence is recorded separately from the original audit.
- Official references checked alongside installed source: [Nuxt useAsyncData](https://nuxt.com/docs/4.x/api/composables/use-async-data) (client-only hydration and shared keyed data) and [Better Auth options](https://better-auth.com/docs/reference/options) (verification auto-sign-in). Recheck version-specific APIs during implementation.
