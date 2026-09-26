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
| `user` | `Readonly<Ref<SessionUser \| null>>` | The logged-in staff member. **No tokens:** they stay in HttpOnly cookies. |
| `isLoggedIn` | `ComputedRef<boolean>` | |
| `checked` | `Readonly<Ref<boolean>>` | Whether the session has been checked against the backend at least once. |
| `fetchSession()` | `() => Promise<SessionUser \| null>` | Calls `GET /staff/auth/session` (refreshing the token if needed). **Never throws:** on any failure the user becomes `null`. |
| `login(credentials)` | `({ username, password }) => Promise<void>` | Calls `POST /staff/auth/login`. The backend sets the cookies. **Throws `ApiError`** on failure (e.g. `kind: 'business'`, "Incorrect username or password"). |
| `logout()` | `() => Promise<void>` | If a form has unsaved changes, asks first and does nothing on "Keep editing" ([`useLeaveGuard`](./forms.md#useleaveguard)). Then calls `POST /staff/auth/logout`, navigates to `/login` and clears the user, even if the request fails. |
| `clearSession()` | `() => void` | Clears the user locally (used when the refresh fails). |

```ts
type SessionUser = Pick<StaffSessionDto, 'staffId' | 'username' | 'displayName' | 'groups'>
```

`groups` holds the staff roles (e.g. `ADMIN`, `CASHIER`). Role-based UI isn't implemented yet (see `docs/progress.md` Q6).

### Example: login form

```ts
const { login } = useAuth()
try {
  await login({ username, password })
  await navigateTo(redirectTo)
}
catch (e) {
  error.value = getErrorMessage(e) // "Incorrect username or password"
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

- The backend sets `staff_access_token` / `staff_refresh_token` as **HttpOnly cookies**, so the frontend can't read them. Every request sends them automatically (`credentials: 'include'`).
- On the first navigation, the middleware calls `fetchSession()` once.
- When any request fails as `unauthorized`, the API layer calls `/staff/auth/refresh` **once** (shared by concurrent requests) and retries. If the refresh fails, the user is cleared and redirected to `/login?redirect=…`.
- Session-expiry errors are never toasted ([`isSilentError`](./errors.md#issilenterror)).
