import type { CounterSession } from '#shared/contracts/identity'

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

const NO_COUNTER_ACCESS = 'This account doesn\'t work at any branch, so it can\'t use the counter.'

const authFetch = <T>(path: string, body: Record<string, unknown> = {}) =>
  $fetch<T>(`/api/auth${path}`, { method: 'POST', body, retry: 0, timeout: 30_000 })

/** 403 from `/counter/me`: signed in, but at no branch (a customer). */
const isNoAccess = (error: ApiError) => error.status === 403

export function useCounterSession() {
  // Captured now: the hooks below run after an `await`, where the Nuxt context is gone.
  const nuxtApp = useNuxtApp()
  // Not `auth:*` (Better Auth's module owns those) and not the admin's `staff-session:*`.
  const user = useState<CounterSession | null>('counter-session:user', () => null)
  const checked = useState('counter-session:checked', () => false)
  const generation = useState('counter-session:generation', () => 0)
  const isSignedIn = computed(() => user.value !== null)
  const mustChangePassword = computed(() => user.value?.mustChangePassword ?? false)

  function setUser(next: CounterSession | null) {
    const changed = (next?.userId ?? null) !== (user.value?.userId ?? null)
    user.value = next
    checked.value = true
    if (changed) {
      generation.value++
      void nuxtApp.callHook('app:session-changed', { signedIn: next !== null })
    }
  }

  /** Reads the session; signed out and "not staff" both count as signed out here. */
  async function fetchSession() {
    try {
      setUser(await apiFetch<CounterSession>('/counter/me'))
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (apiError.kind === 'unauthorized' || isNoAccess(apiError) || !checked.value) setUser(null)
    }
    return user.value
  }

  /** Signs in with Better Auth, then checks the account works at a branch. Throws `ApiError`. */
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
    let session: CounterSession
    try {
      session = await apiFetch<CounterSession>('/counter/me')
    }
    catch (error) {
      const apiError = ApiError.from(error)
      if (!isNoAccess(apiError)) throw apiError
      await authFetch('/sign-out').catch(() => {})
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
      await navigateTo(counterSignInPath(splitTenantUrl(nuxtApp.$router.currentRoute.value.path)?.slug ?? nuxtApp.$config.public.defaultTenant))
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
