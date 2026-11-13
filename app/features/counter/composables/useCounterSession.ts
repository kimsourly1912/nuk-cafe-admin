import type { CounterSession } from '#shared/contracts/identity'
import type { OtherAccess } from '~/utils/account-cafes'

/**
 * The counter workspace (`/counter/**`, step 6.3b, D102). Branch staff, managers and admins sign
 * in here; the admin app stays admins only (D52). Like the admin's `useAuth`, the session is Better
 * Auth's cookie; this keeps who is signed in and the branches they work at
 * (`GET /api/counter/me`), and fires `app:session-changed` when the identity changes, so the
 * session boundary clears the previous person's data (D29).
 */

/** A cafe's counter workspace: `/c/<slug>/counter/…` (D102, D141). */
export const counterHomePath = (slug: string) => tenantUrl(slug, '/counter')
export const counterSignInPath = (slug: string) => tenantUrl(slug, '/counter/sign-in')
export const counterChangePasswordPath = (slug: string) => tenantUrl(slug, '/counter/change-password')

export function isCounterPath(path: string): boolean {
  const inCafe = splitTenantUrl(path)?.path.split(/[?#]/)[0]
  return inCafe === '/counter' || !!inCafe?.startsWith('/counter/')
}

/**
 * Where to go after signing in: the `?redirect=` target if it's a counter page of this cafe (not its
 * sign-in), else the counter's home.
 */
export function counterRedirectTarget(redirect: unknown, slug: string): string {
  if (typeof redirect !== 'string' || splitTenantUrl(redirect)?.slug !== slug) return counterHomePath(slug)
  const path = redirect.split(/[?#]/)[0]!
  return isCounterPath(path) && path !== counterSignInPath(slug) ? redirect : counterHomePath(slug)
}

export interface SignOutOptions {
  /** Come back to this page after the next sign-in (Switch person). */
  switchPerson?: boolean
}

const NO_COUNTER_ACCESS = 'This account doesn\'t work at any branch, so it can\'t use the counter.'

/** 403 from `/counter/me`: signed in, but at no branch (a customer). */
const isNoAccess = (error: ApiError) => error.status === 403

export function useCounterSession() {
  const authFetch = useAuthRequest()
  // Captured now: the hooks below run after an `await`, where the Nuxt context is gone.
  const nuxtApp = useNuxtApp()
  const identity = useSessionIdentity()
  const { user, checked, error: sessionError, generation, signingOut, setUser, reset, fetchSession, supersede, leaveSignedOut } = useWorkspaceSession<CounterSession>('counter', '/counter/me')
  const isSignedIn = computed(() => user.value !== null)
  const mustChangePassword = computed(() => user.value?.mustChangePassword ?? false)

  /** Signs in with Better Auth, then checks the account works at a branch. Throws `ApiError`. */
  async function signIn(credentials: { email: string, password: string }): Promise<PasswordStep> {
    let step: PasswordStep
    try {
      step = passwordStepOf(await authFetch('/sign-in/email', credentials))
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (apiError.kind === 'unauthorized') {
        throw new ApiError('Incorrect email or password.', { kind: 'business', status: apiError.status, code: apiError.code, cause: error })
      }
      throw apiError
    }
    // Two-step sign-in (D188): the page asks for the code, then calls `finishSignIn`.
    if (step === 'two-factor') return step
    await finishSignIn()
    return step
  }

  /** Signed in (by password, or by the code after it): checks the account works at a branch. Throws `ApiError`. */
  async function finishSignIn() {
    let session: CounterSession
    try {
      session = await apiFetch<CounterSession>('/counter/me')
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (!isNoAccess(apiError)) throw apiError
      // Works at another cafe (D239), or the check failed (Q4): stays signed in, and the page says
      // where, or offers Try again. Only an account known to work nowhere is signed out (Q1).
      let access: OtherAccess | null
      try {
        access = await accessInstead(splitTenantUrl(window.location.pathname)?.slug ?? '', 'counter')
      }
      catch {
        throw new WorkspaceRefusedError(null, error)
      }
      if (access) throw new WorkspaceRefusedError(access, error)
      await authFetch('/sign-out').catch(() => {})
      await identity.change('logout', 'counter')
      throw new ApiError(NO_COUNTER_ACCESS, { kind: 'forbidden', status: 403, code: apiError.code, cause: error })
    }
    setUser(session)
  }

  /** Replaces a temporary (or current) password and signs out the account's other sessions. */
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
    // The server cleared the flag: reflect it now, confirm in the background.
    supersede()
    if (user.value?.mustChangePassword) user.value = { ...user.value, mustChangePassword: false }
    void fetchSession()
    await identity.updated()
  }

  /**
   * Signs out to the counter's sign-in. `switchPerson` (account security step 5, Q4): the sign-in
   * then returns to the page being left (its branch), so the next person on a shared tablet carries
   * on there; the server still checks they work at that branch.
   */
  async function signOut(options: SignOutOptions = {}) {
    const { switchPerson = false } = options
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
    const route = nuxtApp.$router.currentRoute.value
    const slug = splitTenantUrl(route.path)?.slug
    // To sign in first, then the identity is cleared: the queue being left never shows empty.
    if (!slug) return await leaveSignedOut(CAFES_PATH)
    const back = switchPerson && isCounterPath(route.path) ? route.fullPath : undefined
    await leaveSignedOut({ path: counterSignInPath(slug), query: back ? { redirect: back } : {} })
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

  /** A route answered PASSWORD_CHANGE_REQUIRED: the middleware moves to the change-password page. */
  function requirePasswordChange() {
    supersede()
    if (user.value && !user.value.mustChangePassword) user.value = { ...user.value, mustChangePassword: true }
  }

  /**
   * Whether the session may take an action at a branch, as `resource:action` (`table:manage`, D240).
   * A branch it doesn't work at: no. For the app only: the server checks every request.
   */
  function can(branchId: string, permission: string) {
    return user.value?.branches.find(branch => branch.id === branchId)?.permissions.includes(permission) ?? false
  }

  return {
    user: readonly(user),
    checked: readonly(checked),
    sessionError: readonly(sessionError),
    resetSession: reset,
    generation: readonly(generation),
    signingOut: readonly(signingOut),
    can,
    isSignedIn,
    mustChangePassword,
    fetchSession,
    signIn,
    finishSignIn,
    changePassword,
    signOut,
    requirePasswordChange,
    twoFactorChanged,
    clearSession: () => reset(true),
  }
}
