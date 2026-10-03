import type { PlatformSession } from '#shared/contracts/tenants'

/**
 * The platform console (`/platform/**`, step T2a, D142): the platform team (super admins) signs in
 * here; a cafe's owners use their cafe's admin. Like the admin's `useAuth` and the counter's
 * session, it's Better Auth's cookie; this keeps who is signed in (`GET /api/platform/me`) and
 * fires `app:session-changed` when the identity changes, so the session boundary clears the
 * previous person's data (D29).
 */

export const PLATFORM_HOME = '/platform'
export const PLATFORM_SIGN_IN = '/platform/sign-in'
export const PLATFORM_CHANGE_PASSWORD = '/platform/change-password'

export const isPlatformPath = (path: string) => path === PLATFORM_HOME || path.startsWith(`${PLATFORM_HOME}/`) || path.startsWith(`${PLATFORM_HOME}?`)

/** Where to go after signing in: the `?redirect=` target if it's a console page (not its sign-in), else the console's home. */
export function platformRedirectTarget(redirect: unknown): string {
  if (typeof redirect !== 'string') return PLATFORM_HOME
  const path = redirect.split(/[?#]/)[0]!
  return isPlatformPath(path) && path !== PLATFORM_SIGN_IN ? redirect : PLATFORM_HOME
}

const NO_PLATFORM_ACCESS = 'This account doesn\'t have access to the platform console.'

const authFetch = <T>(path: string, body: Record<string, unknown> = {}) =>
  $fetch<T>(`/api/auth${path}`, { method: 'POST', body, retry: 0, timeout: 30_000 })

/** 403 from `/platform/me`: signed in, but not on the platform team. */
const isNoAccess = (error: ApiError) => error.status === 403

export function usePlatformSession() {
  // Captured now: the hooks below run after an `await`, where the Nuxt context is gone.
  const nuxtApp = useNuxtApp()
  // Not `auth:*` (Better Auth's module owns those), nor the admin's or the counter's keys.
  const user = useState<PlatformSession | null>('platform-session:user', () => null)
  const checked = useState('platform-session:checked', () => false)
  const generation = useState('platform-session:generation', () => 0)
  const isSignedIn = computed(() => user.value !== null)
  const mustChangePassword = computed(() => user.value?.mustChangePassword ?? false)

  function setUser(next: PlatformSession | null) {
    const changed = (next?.userId ?? null) !== (user.value?.userId ?? null)
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

  /** Signs in with Better Auth, then checks the account is a super admin. Throws `ApiError`. */
  async function signIn(credentials: { email: string, password: string }) {
    try {
      await authFetch('/sign-in/email', credentials)
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (apiError.kind === 'unauthorized') {
        throw new ApiError('Incorrect email or password.', { kind: 'business', status: apiError.status, code: apiError.code, cause: error })
      }
      throw apiError
    }
    let session: PlatformSession
    try {
      session = await apiFetch<PlatformSession>('/platform/me')
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (!isNoAccess(apiError)) throw apiError
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
    await fetchSession()
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
      await navigateTo(PLATFORM_SIGN_IN)
      setUser(null)
    }
  }

  /** A route answered PASSWORD_CHANGE_REQUIRED: the middleware moves to the change-password page. */
  function requirePasswordChange() {
    if (user.value && !user.value.mustChangePassword) user.value = { ...user.value, mustChangePassword: true }
  }

  return {
    user: readonly(user),
    checked: readonly(checked),
    generation: readonly(generation),
    isSignedIn,
    mustChangePassword,
    fetchSession,
    signIn,
    changePassword,
    signOut,
    requirePasswordChange,
    clearSession: () => setUser(null),
  }
}
