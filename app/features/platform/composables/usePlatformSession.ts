import type { PlatformSession } from '#shared/contracts/tenants'
import type { OtherAccess } from '~/utils/account-cafes'

/**
 * The platform console (`/platform/**`, step T2a, D142): the platform team (super admins) signs in
 * here; a cafe's owners use their cafe's admin. Like the admin's `useAuth` and the counter's
 * session, it's Better Auth's cookie; this keeps who is signed in (`GET /api/platform/me`) and
 * fires `app:session-changed` when the identity changes, so the session boundary clears the
 * previous person's data (D29).
 */

/** The console opens on its Overview (P3, D191); the Cafes list is `CAFES_PATH`. */
export const PLATFORM_HOME = '/platform'
export const CAFES_PATH = '/platform/cafes'
export const ACTIVITY_PATH = '/platform/activity'
export const HEALTH_PATH = '/platform/health'
export const PLATFORM_SIGN_IN = '/platform/sign-in'
export const PLATFORM_CHANGE_PASSWORD = '/platform/change-password'
export const PLATFORM_TWO_FACTOR = '/platform/two-factor'

export const isPlatformPath = (path: string) => path === PLATFORM_HOME || path.startsWith(`${PLATFORM_HOME}/`) || path.startsWith(`${PLATFORM_HOME}?`)

/** Where to go after signing in: the `?redirect=` target if it's a console page (not its sign-in), else the console's home. */
export function platformRedirectTarget(redirect: unknown): string {
  if (typeof redirect !== 'string') return PLATFORM_HOME
  const path = redirect.split(/[?#]/)[0]!
  return isPlatformPath(path) && path !== PLATFORM_SIGN_IN ? redirect : PLATFORM_HOME
}

const NO_PLATFORM_ACCESS = 'This account doesn\'t have access to the platform console.'

/** 403 from `/platform/me`: signed in, but not on the platform team. */
const isNoAccess = (error: ApiError) => error.status === 403

export function usePlatformSession() {
  const authFetch = useAuthRequest()
  // Captured now: the hooks below run after an `await`, where the Nuxt context is gone.
  const identity = useSessionIdentity()
  const { user, checked, error: sessionError, generation, signingOut, setUser, reset, fetchSession, supersede } = useWorkspaceSession<PlatformSession>('platform', '/platform/me')
  const isSignedIn = computed(() => user.value !== null)
  const mustChangePassword = computed(() => user.value?.mustChangePassword ?? false)
  const twoFactorEnabled = computed(() => user.value?.twoFactorEnabled ?? false)

  /**
   * The password step of a sign-in. `two-factor`: the page asks for the code (`<TwoFactorCodeForm>`,
   * D188), then calls `finishSignIn`. Throws `ApiError`.
   */
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
    if (step === 'two-factor') return step
    await finishSignIn()
    return step
  }

  /**
   * Signed in (by password, or by the code after it): checks the account is a super admin. Off the
   * team but working at a cafe, or when that can't be checked: stays signed in,
   * `WorkspaceRefusedError` (D241, as the cafes' sign-ins, D239). Working nowhere (a customer): signed
   * out again (Q1). Throws `ApiError`.
   */
  async function finishSignIn() {
    let session: PlatformSession
    try {
      session = await apiFetch<PlatformSession>('/platform/me')
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (!isNoAccess(apiError)) throw apiError
      let access: OtherAccess | null
      try {
        access = await accessInstead('', 'console')
      }
      catch {
        throw new WorkspaceRefusedError(null, error)
      }
      if (access) throw new WorkspaceRefusedError(access, error)
      await authFetch('/sign-out').catch(() => {})
      await identity.change('logout', 'platform')
      throw new ApiError(NO_PLATFORM_ACCESS, { kind: 'forbidden', status: 403, code: apiError.code, cause: error })
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

  async function signOut() {
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
    signingOut.value = true
    reset(true)
    await identity.change('logout', 'platform')
    try {
      await navigateTo(PLATFORM_SIGN_IN)
    }
    finally {
      signingOut.value = false
    }
  }

  /**
   * Two-step sign-in was just turned on or off (`<TwoFactorSetupFrame>`, D188, D242): the server
   * gave this browser a new session. Reflects it now, confirms in the background.
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

  return {
    user: readonly(user),
    checked: readonly(checked),
    sessionError: readonly(sessionError),
    resetSession: reset,
    generation: readonly(generation),
    signingOut: readonly(signingOut),
    isSignedIn,
    mustChangePassword,
    twoFactorEnabled,
    fetchSession,
    signIn,
    finishSignIn,
    twoFactorChanged,
    changePassword,
    signOut,
    requirePasswordChange,
    clearSession: () => reset(true),
  }
}
