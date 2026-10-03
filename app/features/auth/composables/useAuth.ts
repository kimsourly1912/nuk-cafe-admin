import type { AdminSession } from '#shared/contracts/identity'

/** The signed-in admin, kept in state. The session itself is an HttpOnly cookie. */
export type SessionUser = AdminSession

export interface Credentials {
  email: string
  password: string
}

/** Who is signed in, for detecting identity changes. `null`: nobody. */
function identityOf(user: SessionUser | null): string | null {
  return user?.userId ?? null
}

/**
 * A cafe's admin workspace lives under its address, `/c/<slug>/admin` (D93, D141); every other page
 * is the customer site, the counter or the platform's.
 */
export function isAdminPath(path: string): boolean {
  const inCafe = splitTenantUrl(path)?.path.split(/[?#]/)[0]
  return inCafe === '/admin' || !!inCafe?.startsWith('/admin/')
}

/** The cafe's dashboard. */
export const adminHomePath = (slug: string) => tenantUrl(slug, '/admin')

export const loginPath = (slug: string) => tenantUrl(slug, '/admin/login')

/** The page every signed-in admin is sent to while on a temporary password. */
export const changePasswordPath = (slug: string) => tenantUrl(slug, '/admin/change-password')

/**
 * Where to go after login: the `?redirect=` target if it's an admin page of this cafe (never
 * another cafe's or another site's), else the cafe's dashboard.
 */
export function loginRedirectTarget(redirect: unknown, slug: string): string {
  return typeof redirect === 'string' && splitTenantUrl(redirect)?.slug === slug && isAdminPath(redirect) ? redirect : adminHomePath(slug)
}

const NO_ADMIN_ACCESS = 'This account doesn\'t have access to the admin app.'

/** Better Auth's routes (`/api/auth`): same origin, so the session cookie is set and sent. */
const authFetch = <T>(path: string, body: Record<string, unknown> = {}) =>
  $fetch<T>(`/api/auth${path}`, { method: 'POST', body, retry: 0, timeout: 30_000 })

/** 403 from `/admin/me`: signed in, but not an admin (NOT_ADMIN, or the route gate's FORBIDDEN). */
const isNoAccess = (error: ApiError) => error.status === 403

export function useAuth() {
  // Captured now: login/logout call hooks after an `await`, where the Nuxt context is gone.
  const nuxtApp = useNuxtApp()
  // Not `auth:*`: @nuxtjs/better-auth keeps its own session in `auth:user` / `auth:session` and
  // refetches it on its own (startup, tab focus). Sharing a key let it overwrite the staff session.
  const user = useState<SessionUser | null>('staff-session:user', () => null)
  /** Whether the session has been checked against the server at least once. */
  const checked = useState('staff-session:checked', () => false)
  const isLoggedIn = computed(() => user.value !== null)
  /** Signed in on a temporary password: only the change-password page is available (D52). */
  const mustChangePassword = computed(() => user.value?.mustChangePassword ?? false)
  /**
   * Identity generation: +1 whenever the signed-in identity changes (login, logout, expiry,
   * another staff member in another tab). The API layer discards responses to requests started
   * in an older generation, and the session boundary clears the previous identity's data.
   */
  const generation = useState('staff-session:generation', () => 0)

  function setUser(next: SessionUser | null) {
    const changed = identityOf(next) !== identityOf(user.value)
    user.value = next
    checked.value = true
    if (changed) sessionChanged()
  }

  /** Synchronous bump, then the boundary (plugins/session-boundary.client.ts) cleans up. */
  function sessionChanged() {
    generation.value++
    void nuxtApp.callHook('app:session-changed', { signedIn: user.value !== null })
  }

  /**
   * The admin session from `GET /api/admin/me`. Signed out, or signed in without admin access
   * (a customer or branch staff account), both count as logged out here. A network failure keeps
   * the current state.
   */
  async function fetchSession() {
    try {
      setUser(await apiFetch<AdminSession>('/admin/me'))
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (apiError.kind === 'unauthorized' || isNoAccess(apiError) || !checked.value) setUser(null)
    }
    return user.value
  }

  /**
   * Signs in with Better Auth, then checks admin access. An account without it (a customer, branch
   * staff) is signed out again and gets a clear error. Throws `ApiError`.
   */
  async function login(credentials: Credentials) {
    try {
      await authFetch('/sign-in/email', { email: credentials.email, password: credentials.password })
    }
    catch (error) {
      const apiError = ApiError.from(error)
      // Better Auth answers a wrong email or password with 401; here that isn't a lost session.
      if (apiError.kind === 'unauthorized') {
        throw new ApiError('Incorrect email or password.', { kind: 'business', status: apiError.status, code: apiError.code, cause: error })
      }
      throw apiError
    }

    let session: AdminSession
    try {
      session = await apiFetch<AdminSession>('/admin/me')
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (!isNoAccess(apiError)) throw apiError
      // Works at another cafe (T2c, D144): stays signed in, and the page offers Your cafes.
      if (await worksElsewhere(splitTenantUrl(window.location.pathname)?.slug ?? '', 'admin')) {
        throw new ApiError('This account doesn\'t manage this cafe. Open your own cafe from Your cafes.', { kind: 'forbidden', status: 403, code: WORKS_ELSEWHERE, cause: error })
      }
      await authFetch('/sign-out').catch(() => {})
      throw new ApiError(NO_ADMIN_ACCESS, { kind: 'forbidden', status: 403, code: apiError.code, cause: error })
    }
    setUser(session)
    // Other tabs follow (plugins/auth-sync.client.ts).
    await nuxtApp.callHook('app:auth-changed', 'login')
  }

  /**
   * Replaces the password (Better Auth `/change-password`) and signs out the account's other
   * sessions. The server clears a temporary-password flag on success; the session is read again so
   * the app sees that. Throws `ApiError` with a message for the form.
   */
  async function changePassword(currentPassword: string, newPassword: string) {
    try {
      await authFetch('/change-password', { currentPassword, newPassword, revokeOtherSessions: true })
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (apiError.code === 'INVALID_PASSWORD') {
        throw new ApiError('Your current password is incorrect.', { kind: 'business', status: apiError.status, code: apiError.code, cause: error })
      }
      throw apiError
    }
    await fetchSession()
  }

  /** A route answered PASSWORD_CHANGE_REQUIRED: the app moves to the change-password page. */
  function requirePasswordChange() {
    if (user.value && !user.value.mustChangePassword) user.value = { ...user.value, mustChangePassword: true }
  }

  async function logout() {
    // Ask before signing out: once it's sent, staying on the page is no longer possible.
    if (!await useLeaveGuard().confirmLeave()) return
    try {
      await authFetch('/sign-out')
    }
    catch {
      // Signed out locally anyway; the cookie expires on its own.
    }
    finally {
      // Navigate first so the session-lost watcher in plugins/api.ts doesn't also redirect.
      const slug = splitTenantUrl(nuxtApp.$router.currentRoute.value.path)?.slug ?? nuxtApp.$config.public.defaultTenant
      await navigateTo(loginPath(slug))
      clearSession()
      await nuxtApp.callHook('app:auth-changed', 'logout')
    }
  }

  function clearSession() {
    setUser(null)
  }

  /**
   * Whether the signed-in admin may take an action, as `resource:action` (`staff:create`). For
   * hiding UI only: the server decides.
   */
  function can(permission: string) {
    return user.value?.permissions.includes(permission) ?? false
  }

  return {
    user: readonly(user),
    checked: readonly(checked),
    generation: readonly(generation),
    isLoggedIn,
    mustChangePassword,
    fetchSession,
    login,
    changePassword,
    requirePasswordChange,
    logout,
    clearSession,
    can,
  }
}
