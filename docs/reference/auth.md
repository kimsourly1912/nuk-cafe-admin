# Auth

← [API Reference](./README.md)

- [`useAuth`](#useauth)
- [Public pages and the change-password page](#public-pages-and-the-change-password-page)
- [How the session works](#how-the-session-works)
- [Test accounts (local dev)](#test-accounts-local-dev)

Source: `app/features/auth/`. Import it from `~/features/auth` (feature code isn't auto-imported). Paths here are inside a cafe (D141): `/admin/login` means `/c/<slug>/admin/login`; the paths are functions of the cafe (`loginPath(slug)`, `changePasswordPath(slug)`, `adminHomePath(slug)`, `loginRedirectTarget(redirect, slug)`).

---

## `useAuth`

```ts
import { useAuth } from '~/features/auth'

const { user, isLoggedIn, logout } = useAuth()
```

### Returns

| Member | Type | Description |
|---|---|---|
| `user` | `Readonly<Ref<SessionUser \| null>>` | The signed-in admin. **No session token:** Better Auth keeps it in an HttpOnly cookie. |
| `isLoggedIn` | `ComputedRef<boolean>` | |
| `mustChangePassword` | `ComputedRef<boolean>` | On a temporary password: only the change-password page is available. |
| `checked` | `Readonly<Ref<boolean>>` | Whether the session has been checked against the server at least once. |
| `fetchSession()` | `() => Promise<SessionUser \| null>` | Calls `GET /api/admin/me`. **Never throws.** Signed out (401) or signed in without admin access (403) makes the user `null`; a network failure keeps the current state (except on the very first check). |
| `login(credentials)` | `({ email, password }) => Promise<PasswordStep>` | Signs in with Better Auth (`POST /api/auth/sign-in/email`, which sets the cookie), then reads `/api/admin/me`. Answers `'two-factor'` without reading it when the account has two-step sign-in (D188): the page shows `<TwoFactorCodeForm>`, then calls `finishLogin()`, which does the rest. **Throws `ApiError`**: "Incorrect email or password." (`kind: 'business'`), rate limiting, `WorkspaceRefusedError` (a 403 for an account that works somewhere: this cafe's counter or another cafe; or whose check of that failed, with `access: null` and Try again, Q4; it stays signed in and the page shows [`<WorkspaceRefused>`](./ui-helpers.md#your-cafes-and-the-switcher), D239, D241), or "This account doesn't have access to the admin app." (a 403 for an account that works nowhere, a customer, which is then signed out again). |
| `changePassword(current, next)` | `(string, string) => Promise<void>` | Better Auth `POST /api/auth/change-password` with `revokeOtherSessions: true`, then reads the session again (the server has cleared a temporary-password flag). **Throws `ApiError`**: "Your current password is incorrect." (`INVALID_PASSWORD`), Better Auth's `PASSWORD_COMPROMISED` / length messages. |
| `twoFactorChanged(enabled)` | `(boolean) => void` | Two-step sign-in was just turned on or off on the account security page (D242): sets `user.twoFactorEnabled` now and reads the session again in the background (the server swapped this browser's session). `useCounterSession` and `usePlatformSession` have the same. |
| `requirePasswordChange()` | `() => void` | Marks the session as needing a new password (used by `apiFetch` on 403 `PASSWORD_CHANGE_REQUIRED`); `plugins/api.ts` then navigates to the change-password page. |
| `logout()` | `() => Promise<void>` | If a form has unsaved changes, asks first and does nothing on "Keep editing" ([`useLeaveGuard`](./forms.md#useleaveguard)). Then `POST /api/auth/sign-out`, clears the user and goes to `/admin/login` (no `?redirect=`), even if the request fails. Cleared **first**: the login page sends a signed-in admin to the dashboard, which would load after the sign-out; `signingOut` keeps the session-lost redirect in `plugins/api.ts` out of it. The counter's and the console's `signOut()` do the same. Other open tabs go to login too (`plugins/auth-sync.client.ts`). e2e `session.test.ts`, `counter.test.ts`, `platform.test.ts` ("goes straight to …"). |
| `signingOut` | `Readonly<Ref<boolean>>` | True while `logout()` is on its way to the login page. Read only by `plugins/api.ts`. |
| `clearSession()` | `() => void` | Clears the user locally (used by `apiFetch` on a 401 or 403 `NOT_ADMIN`). |
| `can(permission)` | `(string) => boolean` | `'resource:action'` (`'staff:create'`), from the session's `permissions`. Read by the route middleware and the sidebar for each page's `permission` meta (D240). The server checks every request regardless. |

```ts
type SessionUser = AdminSession
// { userId, email, name, role: 'admin', permissions: string[], mustChangePassword, twoFactorEnabled } from #shared/contracts/identity
```

Only the cafe's **owners** may use the admin app (D52): branch managers and staff get "No access to the admin app" at login, stay signed in, and are offered Open the counter (D239). `permissions` lists every `resource:action` the session's role grants (an owner's from `server/features/identity/identity.permissions.ts`, a support visit's from `supportPermissionList()`, D193).

**Page permissions (D240):** an admin route file names the permission its main read asks the server for, `definePageMeta({ title: 'Staff', permission: 'staff:read' })`. `middleware/auth.global.ts` shows **No access to this page** (a fatal 403, code `PAGE_FORBIDDEN`) before the page loads when `can()` says no, and the sidebar and search leave the page out (`allowedNavigation`). Every new admin page names one unless every admin session may open it; `test/unit/page-permissions.test.ts` fails otherwise. Counter branch pages name a `branchPermission` the same way, checked with `useCounterSession().can(branchId, permission)` against `/counter/me`'s per-branch `permissions`.

The state keys are `staff-session:*`, never `auth:*`: `@nuxtjs/better-auth` keeps its own session in `auth:user` and refetches it on startup and tab focus; sharing the key let it overwrite the admin session (e2e: auth.test.ts → "Better Auth refetching its own session…").

Also exported: `CHANGE_PASSWORD_PATH` (`'/change-password'`), `loginRedirectTarget`.

### Example: login form

```ts
const { login } = useAuth()
try {
  await login({ email, password })
  await navigateTo(redirectTo)
}
catch (e) {
  error.value = getErrorMessage(e) // "Incorrect email or password."
}
```

---

## Public pages and the change-password page

**Every page requires a session by default** (`app/middleware/auth.global.ts`). To opt out:

```ts
definePageMeta({ public: true, layout: 'auth' })
```

- The customer site (every path outside `/admin`, D93) is public and never reads the admin session (`isAdminPath`).
- Unauthenticated users on an admin page are sent to `/admin/login?redirect=<original path>`; after login, a `redirect` outside `/admin` goes to `/admin`.
- Logged-in users visiting `/admin/login` are sent to `/admin`.
- **On a temporary password**, every admin page sends to `/admin/change-password?redirect=<original path>` (no sidebar: the `auth` layout). After the change the app continues to that path. The page is also in the user menu ("Change password") for a voluntary change; there it has a Back link, and after saving it goes back.

| Case | Behavior | Tested |
|---|---|---|
| Sign in with a temporary password | `/admin/me` says `mustChangePassword`; every page goes to the change-password page, titled "Choose your password", with Log out | e2e `password.test.ts` |
| Wrong temporary/current password | "Your current password is incorrect."; stays | e2e |
| Repeat doesn't match, or same as the current one | Field errors; nothing sent | e2e, unit `password-form.test.ts` |
| A route answers 403 `PASSWORD_CHANGE_REQUIRED` mid-session | Goes to the change-password page (not a lost session) | e2e, unit `api-fetch.test.ts` |
| Password changed | Other devices are signed out (`revokeOtherSessions`), this one continues | e2e (request body); real-server |
| Typing a new password | The rules' checklist under the field ticks "At least 8 characters" and "Repeat new password matches"; "Not a commonly used password" (last, with why) is checked once typing pauses: a spinner, then ticked or red; no answer leaves it pending until the save ([`<PasswordRequirements>`](./ui-helpers.md#passwordrequirements-and-generatepasswordbutton), D210) | e2e `password.test.ts`, unit `password-requirements.test.ts` |
| Generate a strong password | The button in the New password field fills both new fields with a random `xxxxx-xxxxx-xxxxx-xxxxx` password, turns Show passwords on, and that is what is sent; its leaked-password line ticks | e2e `password.test.ts`, unit `password-requirements.test.ts` |
| Breached new password | Better Auth refuses (`PASSWORD_COMPROMISED`): "This password is too common. Choose another one." on the New password field (focused), the checklist's breach line red until the password is changed, no alert (D210) | e2e `password.test.ts` (mocked answer); real-server (step 1.2) |

---

## Account security: two-step sign-in (D242)

`/c/<slug>/admin/account-security` and `/c/<slug>/counter/account-security` (layout `auth`, in each user menu under Change password) turn two-step sign-in on and off for the signed-in account. Optional for owners and staff, never required at the counter (account security plan, Q1). Every session opens it (no `permission`: it touches only one's own account).

- `<AccountSecurity :enabled :email :back-to :back-label :changed>` (root): the status (**On**/**Off**), **Turn on** (shows `<TwoFactorSetupFrame>` with Cancel), **Turn off** (`<TwoFactorTurnOffModal>`), Back. The feature pages (`auth/AccountSecurityPage.vue`, `counter/CounterAccountSecurityPage.vue`) pass their session's `user.twoFactorEnabled` and `twoFactorChanged`.
- `<TwoFactorSetupFrame :intro :email :done>` (root): the whole setup task frame, shared with the console's `/platform/two-factor`: password → QR code and setup key → backup codes (shown once; Copy, Download; the tick) → a code from the app. Success toasts "Two-step sign-in is on / You were signed out on your other devices." and then awaits `done`; slot `secondary` (`{ saving }`) is the footer's second button (console: Log out; account security: Cancel).
- `<TwoFactorTurnOffModal>` (root): the password, then `useMutation` `account:two-factor-off` (invalidates `staff`); a wrong password beside the field, any other refusal in the modal; `close(true)` once off.
- `useTwoFactorSettings()` (root): `start(password)` (`/two-factor/enable`, `method: 'totp'`), `confirm(code)` (`/two-factor/verify-totp`), `turnOff(password)` (`/two-factor/disable`). `INVALID_PASSWORD` becomes "Your password is incorrect." on the `password` field. Better Auth 1.7.7: enabling again while on is `TOTP_ALREADY_ENABLED`; turning off needs the password and swaps this browser's session.

| Case | Behavior | Tested |
|---|---|---|
| Turn on (owner, cashier) | Password, codes, code; toast; status On; the other sessions end (server after-hook) | e2e `two-factor.test.ts` (mocked); server `identity.two-factor.test.ts` |
| Next sign-in | The password step asks for the code; no session until it | e2e `two-factor.test.ts` (real server, seeded `twoStepCashier`); server |
| Cancel during setup | Back to Off; Better Auth keeps an unverified secret that the next Turn on replaces; nothing is on | e2e |
| Turn off | Password; wrong one beside the field; then Off, and the password alone signs in | e2e (mocked, real server); server |
| A super admin turns it off (e.g. one who owns a cafe) | 403 `TWO_FACTOR_REQUIRED` from a before-hook in `identity.auth.ts` ("The platform team must keep two-step sign-in on."), shown in the modal; still on | server (guard removed: fails); e2e |
| Another person signs in from another tab mid-setup | The page body is keyed by `userId`: it starts over, no key or codes left | e2e `two-factor.test.ts` |
| Support visit (D193) | `useMutation` sends nothing in a read-only session ("Nothing was changed") | by `useMutation` |
| Lost authenticator and backup codes | Not handled in the app yet: open question QA1 | |
| Your devices (D243) | `useAccountSessions` (`account-sessions:list`, `GET /api/me/sessions`): device, sign-in time, **This device**; a failed load is `<ApiErrorAlert>` with Retry. **Sign out N other devices**: `useSignOutOtherDevices` (`account-sessions:sign-out-others`, confirm, Better Auth `/revoke-other-sessions`). Turning two-step sign-in on or off refreshes the list | e2e `two-factor.test.ts` (mocked; real server with two browsers); server `sessions.service.test.ts` |
| A workspace session a day old (D243) | Any admin, counter or console request answers 401 `SESSION_EXPIRED` and the session is deleted; the app's 401 handling goes to sign-in with `?redirect=` | server `workspace-session.test.ts`, `routes.test.ts` |
| Staff | The **Two-step** column (On / Off), the phone row's "Two-step sign-in"; own cafe's people only | e2e `staff.test.ts`; server `staff.service.test.ts` (two cafes) |

## How the session works

- Better Auth (`@nuxtjs/better-auth`, `server/auth.config.ts`) owns accounts and the session cookie (HttpOnly, same origin) and keeps it fresh itself: there is no token refresh in the app.
- A Better Auth account is **not** admin access: customers and branch staff sign in through the same routes. Admin access is the platform role `admin` (`user.role`), checked by the server on every `/api/admin` request.
- On the first navigation, the middleware calls `fetchSession()` once.
- When any request answers 401 or 403 `NOT_ADMIN`, `apiFetch` clears the user and `plugins/api.ts` redirects to `/admin/login?redirect=…`. No retry. (Removing someone's admin role also deletes their sessions, so they usually get a 401.)
- Session-expiry errors are never toasted ([`isSilentError`](./errors.md#issilenterror)).

## Test accounts (local dev)

The local setup on a fresh database, and for trying every role without onboarding each one (D209, D220). Staging and production: [operations → Setting up an empty environment](../server/operations.md#setting-up-an-empty-environment-d220). With `pnpm dev` running:

| Command | Does |
|---|---|
| `pnpm dev:accounts` | Creates or resets the test accounts below and writes them, with their sign-in links, to `dev-accounts.local.md` (git-ignored). Creates NUK Cafe and Second Cafe (`/c/second`) with a Main branch when missing. |
| `pnpm dev:reset <email>` | Any account (one made in the app too) back to the test password, keeping its roles. |
| `pnpm dev:mail` | The 10 newest password reset and email confirmation links from the outbox, sent or not, to follow the real "Forgot password" flow without a mail account. |

| Email | Role | Signs in at |
|---|---|---|
| `superadmin@nuk.test` | Platform super admin, no cafe access | `/platform/sign-in` |
| `owner@nuk.test` | Owner of NUK Cafe | `/c/nuk/admin/login` |
| `manager@nuk.test` / `staff@nuk.test` | Manager / staff at NUK's Main branch | `/c/nuk/counter/sign-in` |
| `customer@nuk.test` | Customer with a member profile at NUK | `/sign-in` |
| `owner@second.test` | Owner of Second Cafe, for checking cafe isolation by hand | `/c/second/admin/login` |

- **Password:** `nuk-dev-password` for all, or `NUXT_DEV_ACCOUNTS_PASSWORD`. Written straight to the database, so the breached-password check (sign-up, change password) doesn't apply to it.
- **Reset:** each run sets the password, the role and exactly that role's access in its cafe (a test account given other access there loses it), and clears a forced password change, two-step sign-in, a ban; it signs the account out everywhere and bumps its version (an open admin form gets a conflict). Audited as `dev.account.reset`.
- **Super admin:** the console still requires two-step sign-in (D188), so after a reset it asks to set it up again (any authenticator app).
- **Dev server only:** the tasks refuse outside `import.meta.dev`, and the services refuse without `dev: true`; Nitro's `/_nitro/tasks` endpoint exists only in dev anyway. The `.test` domain is reserved: these addresses never reach anyone.
- Source: `server/tasks/dev/`, `server/features/identity/dev-accounts.service.ts`, `scripts/dev-accounts.mjs` (`NUXT_DEV_URL` for another address than `http://localhost:3000`). Tests: `server/features/identity/tests/dev-accounts.test.ts`.

## `loginRedirectTarget`

```ts
function loginRedirectTarget(redirect: unknown): string
```

Where to go after login: the `?redirect=` value if it's a path on this site (`/categories`), otherwise `/`. It rejects `//other-site.com` (protocol-relative, an open redirect) and absolute URLs. Used by `LoginPage`, `ChangePasswordPage` and `plugins/auth-sync.client.ts` when another tab logs in. Exported from `~/features/auth`.

## Across tabs

`login()` and `logout()` fire the runtime hook `app:auth-changed`. `plugins/auth-sync.client.ts` forwards it to the app's other open tabs, so they log out (to `/admin/login?redirect=<their page>`) or continue from the login page. Cases: [App-wide behavior → Session loss](./app-behavior.md#session-loss).

## Identity generation

`useAuth().generation` (read-only) increments whenever the signed-in identity changes: login, logout, expiry, or another staff member through another tab. It fires the runtime hook `app:session-changed` (`{ signedIn }`). The API layer uses it to discard responses from an earlier identity, and `plugins/session-boundary.client.ts` clears that identity's data, toasts, overlays and forms. Features don't use it directly. Contract: [App-wide behavior → Session-transition contract](./app-behavior.md#session-transition-contract) (D29).


## Account browser verification (D217)

`useAuthRequest()` is the shared transport behind the four account/session composables. It captures Nuxt context during setup and returns the existing typed POST helper. With the deployed public configuration enabled, sign-in, sign-up, reset-email requests and verification-email resends open `HumanCheckModal`; cancel/Back preserves input and sends no request. Each submit uses a fresh single-use token header, with automatic HTTP retries disabled. The server independently requires strict action/hostname verification; changing client configuration cannot bypass it. Other auth actions retain their original behavior.

The modal loads Cloudflare's official script only on demand, removes each widget on close, and offers retry after load/network/expiry failure. Do not store tokens in state, localStorage, analytics or logs. See [operations](../server/operations.md#account-browser-verification-d217) and [verification evidence](../progress.md#cloudflare-account-bot-protection-d217-2026-10-27).
