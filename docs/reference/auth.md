# Auth

← [API Reference](./README.md)

- [`useAuth`](#useauth)
- [Public pages and the change-password page](#public-pages-and-the-change-password-page)
- [How the session works](#how-the-session-works)
- [First admin (local setup)](#first-admin-local-setup)

Source: `app/features/auth/`. Import it from `~/features/auth` (feature code isn't auto-imported).

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
| `login(credentials)` | `({ email, password }) => Promise<void>` | Signs in with Better Auth (`POST /api/auth/sign-in/email`, which sets the cookie), then reads `/api/admin/me`. **Throws `ApiError`**: "Incorrect email or password." (`kind: 'business'`), rate limiting, or "This account doesn't have access to the admin app." (any 403: a customer or branch staff account, which is then signed out again). |
| `changePassword(current, next)` | `(string, string) => Promise<void>` | Better Auth `POST /api/auth/change-password` with `revokeOtherSessions: true`, then reads the session again (the server has cleared a temporary-password flag). **Throws `ApiError`**: "Your current password is incorrect." (`INVALID_PASSWORD`), Better Auth's `PASSWORD_COMPROMISED` / length messages. |
| `requirePasswordChange()` | `() => void` | Marks the session as needing a new password (used by `apiFetch` on 403 `PASSWORD_CHANGE_REQUIRED`); `plugins/api.ts` then navigates to the change-password page. |
| `logout()` | `() => Promise<void>` | If a form has unsaved changes, asks first and does nothing on "Keep editing" ([`useLeaveGuard`](./forms.md#useleaveguard)). Then `POST /api/auth/sign-out`, navigates to `/admin/login` and clears the user, even if the request fails. Other open tabs go to login too (`plugins/auth-sync.client.ts`). |
| `clearSession()` | `() => void` | Clears the user locally (used by `apiFetch` on a 401 or 403 `NOT_ADMIN`). |
| `can(permission)` | `(string) => boolean` | `'resource:action'` (`'staff:create'`), from the session's `permissions`. For hiding actions. The server checks every request regardless. |

```ts
type SessionUser = AdminSession
// { userId, email, name, role: 'admin', permissions: string[], mustChangePassword } from #shared/contracts/identity
```

Only platform **admins** may use the admin app for now (D52): branch managers and staff get "no access" at login; their screens come with the counter app. `permissions` lists every `resource:action` the platform role grants (from `server/features/identity/identity.permissions.ts`).

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
| Breached new password | Better Auth refuses (`PASSWORD_COMPROMISED`), message shown | real-server (step 1.2) |

---

## How the session works

- Better Auth (`@nuxtjs/better-auth`, `server/auth.config.ts`) owns accounts and the session cookie (HttpOnly, same origin) and keeps it fresh itself: there is no token refresh in the app.
- A Better Auth account is **not** admin access: customers and branch staff sign in through the same routes. Admin access is the platform role `admin` (`user.role`), checked by the server on every `/api/admin` request.
- On the first navigation, the middleware calls `fetchSession()` once.
- When any request answers 401 or 403 `NOT_ADMIN`, `apiFetch` clears the user and `plugins/api.ts` redirects to `/admin/login?redirect=…`. No retry. (Removing someone's admin role also deletes their sessions, so they usually get a 401.)
- Session-expiry errors are never toasted ([`isSilentError`](./errors.md#issilenterror)).

## First admin (local setup)

With the dev server running and `NUXT_SEED_ADMIN_EMAIL` set:

```bash
curl http://localhost:3000/_nitro/tasks/db:seed
```

prints the first admin's temporary password (and creates a demo branch). Sign in at `/admin/login`; the app asks for a new password first. More staff: the **Staff** page. See [operations → Seed data](../server/operations.md).

## `loginRedirectTarget`

```ts
function loginRedirectTarget(redirect: unknown): string
```

Where to go after login: the `?redirect=` value if it's a path on this site (`/categories`), otherwise `/`. It rejects `//other-site.com` (protocol-relative, an open redirect) and absolute URLs. Used by `LoginPage`, `ChangePasswordPage` and `plugins/auth-sync.client.ts` when another tab logs in. Exported from `~/features/auth`.

## Across tabs

`login()` and `logout()` fire the runtime hook `app:auth-changed`. `plugins/auth-sync.client.ts` forwards it to the app's other open tabs, so they log out (to `/admin/login?redirect=<their page>`) or continue from the login page. Cases: [App-wide behavior → Session loss](./app-behavior.md#session-loss).

## Identity generation

`useAuth().generation` (read-only) increments whenever the signed-in identity changes: login, logout, expiry, or another staff member through another tab. It fires the runtime hook `app:session-changed` (`{ signedIn }`). The API layer uses it to discard responses from an earlier identity, and `plugins/session-boundary.client.ts` clears that identity's data, toasts, overlays and forms. Features don't use it directly. Contract: [App-wide behavior → Session-transition contract](./app-behavior.md#session-transition-contract) (D29).
