import type { StaffSession } from '#shared/contracts/identity'

/** The signed-in staff member, kept in state. The session itself is an HttpOnly cookie. */
export type SessionUser = StaffSession

export interface Credentials {
  email: string
  password: string
}

/** Who is signed in, for detecting identity changes. `null`: nobody. */
function identityOf(user: SessionUser | null): string | null {
  return user?.userId ?? null
}

/** Where to go after login: the `?redirect=` target if it's a path on this site, else the dashboard. */
export function loginRedirectTarget(redirect: unknown): string {
  return typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
}

/** Better Auth's routes (`/api/auth`): same origin, so the session cookie is set and sent. */
const authFetch = <T>(path: string, body: Record<string, unknown> = {}) =>
  $fetch<T>(`/api/auth${path}`, { method: 'POST', body, retry: 0, timeout: 30_000 })

export function useAuth() {
  // Captured now: login/logout call hooks after an `await`, where the Nuxt context is gone.
  const nuxtApp = useNuxtApp()
  // Not `auth:*`: @nuxtjs/better-auth keeps its own session in `auth:user` / `auth:session` and
  // refetches it on its own (startup, tab focus). Sharing a key let it overwrite the staff session.
  const user = useState<SessionUser | null>('staff-session:user', () => null)
  /** Whether the session has been checked against the server at least once. */
  const checked = useState('staff-session:checked', () => false)
  const isLoggedIn = computed(() => user.value !== null)
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
   * The staff session from `GET /api/v1/admin/me`. Signed out, or signed in without staff access
   * (a customer account), both count as logged out here. A network failure keeps the current state.
   */
  async function fetchSession() {
    try {
      setUser(await apiFetch<StaffSession>('/admin/me'))
    }
    catch (error) {
      const { kind, code } = ApiError.from(error)
      if (kind === 'unauthorized' || code === 'NOT_STAFF' || !checked.value) setUser(null)
    }
    return user.value
  }

  /**
   * Signs in with Better Auth, then checks staff access. An account without it (e.g. a customer)
   * is signed out again and gets a clear error. Throws `ApiError`.
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

    let session: StaffSession
    try {
      session = await apiFetch<StaffSession>('/admin/me')
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (apiError.code === 'NOT_STAFF') await authFetch('/sign-out').catch(() => {})
      throw apiError
    }
    setUser(session)
    // Other tabs follow (plugins/auth-sync.client.ts).
    await nuxtApp.callHook('app:auth-changed', 'login')
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
      await navigateTo('/login')
      clearSession()
      await nuxtApp.callHook('app:auth-changed', 'logout')
    }
  }

  function clearSession() {
    setUser(null)
  }

  /** Whether the signed-in staff member has a permission (for hiding actions; the server decides). */
  function can(permission: StaffSession['permissions'][number]) {
    return user.value?.permissions.includes(permission) ?? false
  }

  return {
    user: readonly(user),
    checked: readonly(checked),
    generation: readonly(generation),
    isLoggedIn,
    fetchSession,
    login,
    logout,
    clearSession,
    can,
  }
}
