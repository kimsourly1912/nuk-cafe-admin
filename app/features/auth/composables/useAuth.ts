import type { AdminSession } from '#shared/contracts/identity'
import type { OtherAccess } from '~/utils/account-cafes'

/** The signed-in admin, kept in state. The session itself is an HttpOnly cookie. */
export type SessionUser = AdminSession

export interface Credentials {
  email: string
  password: string
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
  return typeof redirect === 'string' && splitTenantUrl(redirect)?.slug === slug && isAdminPath(redirect) && redirect.split(/[?#]/)[0] !== loginPath(slug) ? redirect : adminHomePath(slug)
}

const NO_ADMIN_ACCESS = 'This account doesn\'t have access to the admin app.'

/** 403 from `/admin/me`: signed in, but not an admin (NOT_ADMIN, or the route gate's FORBIDDEN). */
const isNoAccess = (error: ApiError) => error.status === 403

export function useAuth() {
  const authFetch = useAuthRequest()
  // Captured now: login/logout call hooks after an `await`, where the Nuxt context is gone.
  const nuxtApp = useNuxtApp()
  const identity = useSessionIdentity()
  const { user, checked, error: sessionError, generation, signingOut, setUser, reset, fetchSession, supersede, leaveSignedOut } = useWorkspaceSession<AdminSession>('admin', '/admin/me')
  const isLoggedIn = computed(() => user.value !== null)
  const mustChangePassword = computed(() => user.value?.mustChangePassword ?? false)

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
      await identity.change('logout', 'admin')
      throw new ApiError(NO_ADMIN_ACCESS, { kind: 'forbidden', status: 403, code: apiError.code, cause: error })
    }
    setUser(session)
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
    supersede()
    if (user.value?.mustChangePassword) user.value = { ...user.value, mustChangePassword: false }
    void fetchSession()
    await identity.updated()
  }

  /**
   * Two-step sign-in was just turned on or off on the account security page (D242): the server gave
   * this browser a new session. Reflects it now, confirms in the background.
   */
  function twoFactorChanged(enabled: boolean) {
    supersede()
    if (user.value && user.value.twoFactorEnabled !== enabled) user.value = { ...user.value, twoFactorEnabled: enabled }
    void fetchSession()
    void identity.updated()
  }

  /** A route answered PASSWORD_CHANGE_REQUIRED: the app moves to the change-password page. */
  function requirePasswordChange() {
    supersede()
    if (user.value && !user.value.mustChangePassword) user.value = { ...user.value, mustChangePassword: true }
  }

  async function logout() {
    if (!await useLeaveGuard().confirmLeave()) return
    const startedIn = identity.generation.value
    try {
      await authFetch('/sign-out')
    }
    catch (error) {
      if (ApiError.from(error).kind === 'aborted') return
      // Preserve the existing local sign-out behavior when the network fails.
    }
    if (identity.generation.value !== startedIn) return
    const slug = splitTenantUrl(nuxtApp.$router.currentRoute.value.path)?.slug
    // To login first, then the identity is cleared: the page being left never shows empty.
    await leaveSignedOut(slug ? loginPath(slug) : CAFES_PATH)
  }

  function clearSession() {
    reset(true)
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
    sessionError: readonly(sessionError),
    resetSession: reset,
    generation: readonly(generation),
    signingOut: readonly(signingOut),
    isLoggedIn,
    mustChangePassword,
    fetchSession,
    login,
    finishLogin,
    changePassword,
    requirePasswordChange,
    twoFactorChanged,
    logout,
    clearSession,
    can,
  }
}
