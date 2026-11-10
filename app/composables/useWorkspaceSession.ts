import type { RouteLocationRaw } from 'vue-router'
import type { SessionSurface } from './useSessionIdentity'

type WorkspaceSurface = Exclude<SessionSurface, 'account'>
const SESSION_KEYS = { admin: 'staff-session', counter: 'counter-session', platform: 'platform-session' } as const

/** Longest wait for the sign-in page to replace the page being left, before clearing anyway. */
const PAGE_SWAP_TIMEOUT = 2000

/** Shared lifecycle only; each feature still owns its authorization and sign-in rules. */
export function useWorkspaceSession<T extends { userId: string }>(surface: WorkspaceSurface, path: string) {
  const key = SESSION_KEYS[surface]
  // Captured now: `leaveSignedOut` runs after an `await`, where the Nuxt context is gone.
  const nuxtApp = useNuxtApp()
  const identity = useSessionIdentity()
  const user = useState<T | null>(`${key}:user`, () => null)
  const checked = useState(`${key}:checked`, () => false)
  const error = useState<ApiError | undefined>(`${key}:error`, () => undefined)
  const revision = useState(`${key}:revision`, () => 0)
  const signingOut = useState(`${key}:signing-out`, () => false)

  function setUser(next: T | null) {
    user.value = next
    checked.value = true
    error.value = undefined
    if (next) identity.observe(next.userId, surface)
  }

  function reset(signedOut = false) {
    revision.value++
    user.value = null
    checked.value = signedOut
    error.value = undefined
  }

  async function fetchSession() {
    const read = ++revision.value
    const startedIn = identity.generation.value
    try {
      const next = await apiFetch<T>(path, { isCurrent: () => read === revision.value })
      if (read === revision.value && startedIn === identity.generation.value) setUser(next)
    }
    catch (cause) {
      if (read !== revision.value || startedIn !== identity.generation.value) return user.value
      const failure = ApiError.from(cause)
      if (failure.kind === 'unauthorized' || failure.status === 403) setUser(null)
      else if (failure.kind !== 'aborted') error.value = failure
    }
    return user.value
  }

  /** An optimistic password/2FA update supersedes every earlier read, even for the same user. */
  function supersede() {
    revision.value++
  }

  /**
   * A voluntary sign-out, after the server has ended the session: moves to `to` (the sign-in page)
   * first, and clears this identity only once that page is on screen. Clearing first re-rendered
   * the page being left without its session and data: its empty states flashed before sign-in.
   * `signingOut` keeps the sign-in page's middleware from sending the still-known user back, and the
   * session-lost watchers from redirecting a second time. The identity is cleared even when the
   * navigation fails; then it moves again, as a plain signed-out navigation.
   */
  async function leaveSignedOut(to: RouteLocationRaw) {
    const router = nuxtApp.$router
    const from = router.currentRoute.value.fullPath
    signingOut.value = true
    let moved: boolean
    try {
      let unhook = () => {}
      const swapped = new Promise<void>((resolve) => {
        unhook = nuxtApp.hooks.hookOnce('page:finish', () => resolve())
      })
      const failure = await nuxtApp.runWithContext(() => navigateTo(to))
      moved = !failure && router.currentRoute.value.fullPath !== from
      if (moved) {
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([swapped, new Promise<void>((resolve) => {
          timer = setTimeout(resolve, PAGE_SWAP_TIMEOUT)
        })])
        clearTimeout(timer)
      }
      unhook()
    }
    finally {
      reset(true)
      await identity.change('logout', surface)
      signingOut.value = false
    }
    if (!moved) await nuxtApp.runWithContext(() => navigateTo(to))
  }

  return { user, checked, error, signingOut, generation: identity.generation, setUser, reset, fetchSession, supersede, leaveSignedOut }
}
