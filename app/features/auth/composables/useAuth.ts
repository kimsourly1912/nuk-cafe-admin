import type { AdminSession } from '#shared/contracts/identity'
import type { OtherAccess } from '~/utils/account-cafes'

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

/** 403 from `/admin/me`: signed in, but not an admin (NOT_ADMIN, or the route gate's FORBIDDEN). */
const isNoAccess = (error: ApiError) => error.status === 403

export function useAuth() {
  const authFetch = useAuthRequest()
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
  /** A voluntary logout is on its way to the login page (see `logout`). */
  const signingOut = useState('staff-session:signing-out', () => false)

  function setUser(next: SessionUser | null) {
    // The first check isn't a change: this tab knew no staff identity before it, and what it loaded
    // (the customer site's account and menu) came with the same browser session (D97). Counting it
    // cleared and refetched the page being left, so its header flashed "Sign in".
    const changed = checked.value && identityOf(next) !== identityOf(user.value)
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
   * Signs in with Better Auth, then checks admin access. An account without it that works somewhere
   * (branch staff, another cafe's owner), or whose check failed, stays signed in:
   * `WorkspaceRefusedError` (D239, Q4). Any other (a customer) is signed out again and gets a clear
   * error. Throws `ApiError`.
   */
  async function login(credentials: Credentials): Promise<PasswordStep> {
    let step: PasswordStep
    try {
      step = passwordStepOf(await authFetch('/sign-in/email', { email: credentials.email, password: credentials.password }))
    }
    catch (error) {
      const apiError = ApiError.from(error)
      // Better Auth answers a wrong email or password with 401; here that isn't a lost session.
      if (apiError.kind === 'unauthorized') {
        throw new ApiError('Incorrect email or password.', { kind: 'business', status: apiError.status, code: apiError.code, cause: error })
      }
      throw apiError
    }
    // Two-step sign-in (D188): the page asks for the code, then calls `finishLogin`.
    if (step === 'two-factor') return step
    await finishLogin()
    return step
  }

  /** Signed in (by password, or by the code after it): checks the account manages this cafe. Throws `ApiError`. */
  async function finishLogin() {
    let session: AdminSession
    try {
      session = await apiFetch<AdminSession>('/admin/me')
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (!isNoAccess(apiError)) throw apiError
      // Works somewhere (this cafe's counter, another cafe, D239): stays signed in, and the page says where.
      // The check failed (the network): stays signed in too, with Try again (Q4); only an account
      // known to work nowhere (a customer) is signed out again (Q1).
      let access: OtherAccess | null
      try {
        access = await accessInstead(splitTenantUrl(window.location.pathname)?.slug ?? '', 'admin')
      }
      catch {
        throw new WorkspaceRefusedError(null, error)
      }
      if (access) throw new WorkspaceRefusedError(access, error)
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
    // The server cleared the flag: reflect that now so the route middleware lets the next page
    // through without waiting for a round trip, then confirm against the server in the background.
    if (user.value?.mustChangePassword) user.value = { ...user.value, mustChangePassword: false }
    void fetchSession()
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
      // Signed out before leaving: the sign-in page's guard would send a session still here back to
      // the home page, which then loads after the sign-out. `signingOut` keeps the session-lost
      // watcher (plugins/api.ts) from also redirecting, with a `?redirect=` to this page.
      // Signing out happens in a cafe's admin; without a cafe (never expected) the cafe list, not a guess (D221).
      const slug = splitTenantUrl(nuxtApp.$router.currentRoute.value.path)?.slug
      signingOut.value = true
      clearSession()
      try {
        await navigateTo(slug ? loginPath(slug) : CAFES_PATH)
      }
      finally {
        signingOut.value = false
      }
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
    signingOut: readonly(signingOut),
    isLoggedIn,
    mustChangePassword,
    fetchSession,
    login,
    finishLogin,
    changePassword,
    requirePasswordChange,
    logout,
    clearSession,
    can,
  }
}
