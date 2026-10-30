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
  const nuxtApp = useNuxtApp()
  // Not `auth:*` (Better Auth's module owns those), nor the admin's or the counter's keys.
  const user = useState<PlatformSession | null>('platform-session:user', () => null)
  const checked = useState('platform-session:checked', () => false)
  const generation = useState('platform-session:generation', () => 0)
  /** A voluntary sign-out is on its way to the sign-in page (see `signOut`). */
  const signingOut = useState('platform-session:signing-out', () => false)
  const isSignedIn = computed(() => user.value !== null)
  const mustChangePassword = computed(() => user.value?.mustChangePassword ?? false)
  /** Two-step sign-in is set up (D188): until it is, the console's only page is its setup. */
  const twoFactorEnabled = computed(() => user.value?.twoFactorEnabled ?? false)

  function setUser(next: PlatformSession | null) {
    // The first check isn't a change (see the admin's useAuth `setUser`).
    const changed = checked.value && (next?.userId ?? null) !== (user.value?.userId ?? null)
    user.value = next
    checked.value = true
    if (changed) {
      generation.value++
      void nuxtApp.callHook('app:session-changed', { signedIn: next !== null })
    }
  }

  /** Reads the session; signed out and "not a super admin" both count as signed out here. */
  async function fetchSession() {
    try {
      setUser(await apiFetch<PlatformSession>('/platform/me'))
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (apiError.kind === 'unauthorized' || isNoAccess(apiError) || !checked.value) setUser(null)
    }
    return user.value
  }

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
    if (user.value?.mustChangePassword) user.value = { ...user.value, mustChangePassword: false }
    void fetchSession()
  }

  async function signOut() {
    if (!await useLeaveGuard().confirmLeave()) return
    try {
      await authFetch('/sign-out')
    }
    catch {
      // Signed out here anyway; the cookie expires on its own.
    }
    finally {
      // Signed out before leaving: the sign-in page's guard would send a session still here back to
      // the home page, which then loads after the sign-out. `signingOut` keeps the session-lost
      // watcher (plugins/api.ts) from also redirecting, with a `?redirect=` to this page.
      const target = PLATFORM_SIGN_IN
      signingOut.value = true
      setUser(null)
      try {
        await navigateTo(target)
      }
      finally {
        signingOut.value = false
      }
    }
  }

  /**
   * Starts setting up two-step sign-in (D188): checks the password, and answers what the app needs
   * (the `otpauth://` link for the QR code) and the backup codes, shown once. Nothing is on until
   * `confirmTwoFactor` gets a right code. Throws `ApiError`.
   */
  async function startTwoFactor(password: string): Promise<{ totpURI: string, backupCodes: string[] }> {
    try {
      return await authFetch<{ totpURI: string, backupCodes: string[] }>('/two-factor/enable', { password, method: 'totp' })
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (apiError.code === 'INVALID_PASSWORD') {
        throw new ApiError('Your password is incorrect.', { kind: 'business', status: apiError.status, code: apiError.code, cause: error })
      }
      throw apiError
    }
  }

  /**
   * A code from the app turns two-step sign-in on. The server signs the account out on its other
   * devices and gives this one a new session. Throws `ApiError`.
   */
  async function confirmTwoFactor(code: string) {
    await verifyTwoFactorCode('app', code)
    // Reflect it now, confirm in the background.
    if (user.value && !user.value.twoFactorEnabled) user.value = { ...user.value, twoFactorEnabled: true }
    void fetchSession()
  }

  /** A route answered PASSWORD_CHANGE_REQUIRED: the middleware moves to the change-password page. */
  function requirePasswordChange() {
    if (user.value && !user.value.mustChangePassword) user.value = { ...user.value, mustChangePassword: true }
  }

  return {
    user: readonly(user),
    checked: readonly(checked),
    generation: readonly(generation),
    signingOut: readonly(signingOut),
    isSignedIn,
    mustChangePassword,
    twoFactorEnabled,
    fetchSession,
    signIn,
    finishSignIn,
    startTwoFactor,
    confirmTwoFactor,
    changePassword,
    signOut,
    requirePasswordChange,
    clearSession: () => setUser(null),
  }
}
