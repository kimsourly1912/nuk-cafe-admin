import type { PasswordGrantDto, StaffSessionDto } from '~/generated/api'
import { login as loginRequest, logout as logoutRequest, session as sessionRequest } from '~/generated/api'

/** Session info kept in state. Tokens stay in HttpOnly cookies and are never stored here. */
export type SessionUser = Pick<StaffSessionDto, 'staffId' | 'username' | 'displayName' | 'groups'>

/** Who is signed in, for detecting identity changes. `null`: nobody. */
function identityOf(user: SessionUser | null): string | null {
  return user ? String(user.staffId ?? user.username) : null
}

/** Where to go after login: the `?redirect=` target if it's a path on this site, else the dashboard. */
export function loginRedirectTarget(redirect: unknown): string {
  return typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
}

export function useAuth() {
  // Captured now: login/logout call hooks after an `await`, where the Nuxt context is gone.
  const nuxtApp = useNuxtApp()
  const user = useState<SessionUser | null>('auth:user', () => null)
  /** Whether the session has been checked against the backend at least once. */
  const checked = useState('auth:checked', () => false)
  const isLoggedIn = computed(() => user.value !== null)
  /**
   * Identity generation: +1 whenever the signed-in identity changes (login, logout, expiry,
   * another staff member in another tab). The API layer discards responses to requests started
   * in an older generation, and the session boundary clears the previous identity's data.
   */
  const generation = useState('auth:generation', () => 0)

  function setUser(dto: StaffSessionDto | undefined) {
    const next: SessionUser | null = dto
      ? { staffId: dto.staffId, username: dto.username, displayName: dto.displayName, groups: dto.groups }
      : null
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

  /** Validates the cookie session via `/staff/auth/session` (refreshing if needed). */
  async function fetchSession() {
    try {
      setUser(await unwrap(sessionRequest({})))
    }
    catch {
      setUser(undefined)
    }
    return user.value
  }

  /** Throws `ApiError` on bad credentials. The backend sets the auth cookies. */
  async function login(credentials: PasswordGrantDto) {
    setUser(await unwrap(loginRequest({ body: credentials })))
    // Other tabs follow (plugins/auth-sync.client.ts).
    await nuxtApp.callHook('app:auth-changed', 'login')
  }

  async function logout() {
    // Ask before the backend logout: once it's sent, staying on the page is no longer possible.
    if (!await useLeaveGuard().confirmLeave()) return
    try {
      await logoutRequest({})
    }
    finally {
      // Navigate first so the session-expired watcher in plugins/api.ts doesn't also redirect.
      await navigateTo('/login')
      clearSession()
      await nuxtApp.callHook('app:auth-changed', 'logout')
    }
  }

  function clearSession() {
    setUser(undefined)
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
  }
}
