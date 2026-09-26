# Auth

← [API Reference](./README.md)

- [`useAuth`](#useauth)
- [Public pages](#public-pages)
- [How the session works](#how-the-session-works)

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
| `user` | `Readonly<Ref<SessionUser \| null>>` | The signed-in staff member. **No session token:** Better Auth keeps it in an HttpOnly cookie. |
| `isLoggedIn` | `ComputedRef<boolean>` | |
| `checked` | `Readonly<Ref<boolean>>` | Whether the session has been checked against the server at least once. |
| `fetchSession()` | `() => Promise<SessionUser \| null>` | Calls `GET /api/v1/admin/me`. **Never throws.** Signed out (401) or signed in without staff access (403 NOT_STAFF) makes the user `null`; a network failure keeps the current state (except on the very first check). |
| `login(credentials)` | `({ email, password }) => Promise<void>` | Signs in with Better Auth (`POST /api/auth/sign-in/email`, which sets the cookie), then reads `/api/v1/admin/me`. **Throws `ApiError`**: "Incorrect email or password." (`kind: 'business'`), rate limiting, or 403 NOT_STAFF (the account is then signed out again). |
| `logout()` | `() => Promise<void>` | If a form has unsaved changes, asks first and does nothing on "Keep editing" ([`useLeaveGuard`](./forms.md#useleaveguard)). Then `POST /api/auth/sign-out`, navigates to `/login` and clears the user, even if the request fails. Other open tabs go to login too (`plugins/auth-sync.client.ts`). |
| `clearSession()` | `() => void` | Clears the user locally (used by `apiFetch` on a 401 or 403 NOT_STAFF). |
| `can(permission)` | `(Permission) => boolean` | For hiding actions. The server checks every request regardless. |

```ts
type SessionUser = StaffSession // { userId, email, displayName, role, permissions } from #shared/contracts/identity
```

Only the `admin` role exists (every permission) until the role matrix is decided (Q6, D40).

The state keys are `staff-session:*`, never `auth:*`: `@nuxtjs/better-auth` keeps its own session in `auth:user` and refetches it on startup and tab focus; sharing the key let it overwrite the staff session (e2e: auth.test.ts → "Better Auth refetching its own session…").

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

## Public pages

**Every page requires a session by default** (`app/middleware/auth.global.ts`). To opt out:

```ts
definePageMeta({ public: true, layout: 'auth' })
```

- Unauthenticated users are sent to `/login?redirect=<original path>`.
- Logged-in users visiting `/login` are sent to `/`.

---

## How the session works

- Better Auth (`@nuxtjs/better-auth`, `server/auth.config.ts`) owns accounts and the session cookie (HttpOnly, same origin) and keeps it fresh itself: there is no token refresh in the app.
- A Better Auth account is **not** staff access: customers sign up through the same routes. Staff access is an active `staff_profiles` row, checked by the server on every admin request (D40).
- On the first navigation, the middleware calls `fetchSession()` once.
- When any request answers 401 or 403 NOT_STAFF, `apiFetch` clears the user and `plugins/api.ts` redirects to `/login?redirect=…`. No retry.
- The first admin is created with the bootstrap route ([API → Identity](./api.md#identity)).
- Session-expiry errors are never toasted ([`isSilentError`](./errors.md#issilenterror)).

## `loginRedirectTarget`

```ts
function loginRedirectTarget(redirect: unknown): string
```

Where to go after login: the `?redirect=` value if it's a path on this site (`/categories`), otherwise `/`. It rejects `//other-site.com` (protocol-relative, an open redirect) and absolute URLs. Used by `LoginPage` and by `plugins/auth-sync.client.ts` when another tab logs in. Exported from `~/features/auth`.

## Across tabs

`login()` and `logout()` fire the runtime hook `app:auth-changed`. `plugins/auth-sync.client.ts` forwards it to the app's other open tabs, so they log out (to `/login?redirect=<their page>`) or continue from the login page. Cases: [App-wide behavior → Session loss](./app-behavior.md#session-loss).

## Identity generation

`useAuth().generation` (read-only) increments whenever the signed-in identity changes: login, logout, expiry, or another staff member through another tab. It fires the runtime hook `app:session-changed` (`{ signedIn }`). The API layer uses it to discard responses from an earlier identity, and `plugins/session-boundary.client.ts` clears that identity's data, toasts, overlays and forms. Features don't use it directly. Contract: [App-wide behavior → Session-transition contract](./app-behavior.md#session-transition-contract) (D29).
