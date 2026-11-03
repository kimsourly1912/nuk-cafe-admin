export type SessionSurface = 'admin' | 'counter' | 'platform' | 'account'
export type AuthChange = 'login' | 'logout'
export type AuthEvent = AuthChange | 'refresh'

/** One browser identity, with separate authorization sessions for each workspace. */
export function useSessionIdentity() {
  const nuxtApp = useNuxtApp()
  const state = useState<{ known: boolean, userId: string | null, generation: number }>('session-identity', () => ({ known: false, userId: null, generation: 0 }))
  const generation = computed(() => state.value.generation)

  function advance(signedIn: boolean, source?: SessionSurface) {
    state.value.generation++
    return nuxtApp.callHook('app:session-changed', { signedIn, source })
  }

  /** Initial discovery is not a change. A later, different identity clears the old one's data. */
  function observe(userId: string | null, source: SessionSurface) {
    const changed = state.value.known && state.value.userId !== userId
    state.value.known = true
    state.value.userId = userId
    if (changed) void advance(userId !== null, source)
  }

  /** Auth writes know the cookie changed before the next surface session has answered. */
  async function change(event: AuthChange, source?: SessionSurface, broadcast = true) {
    if (event === 'logout' && state.value.known && state.value.userId === null) return
    state.value.known = event === 'logout'
    state.value.userId = null
    await advance(event === 'login', source)
    if (broadcast) await nuxtApp.callHook('app:auth-changed', event)
  }

  function assertCurrent(startedIn: number) {
    if (generation.value !== startedIn) throw new ApiError('This request is no longer current.', { kind: 'aborted', status: 0 })
  }

  /** Password/2FA flags changed for this identity; keep its forms and data while rechecking. */
  async function updated() {
    await nuxtApp.callHook('app:auth-changed', 'refresh')
    await nuxtApp.runWithContext(() => invalidateInThisTab(['account', 'account-sessions']))
  }

  return { generation, isSignedIn: computed(() => state.value.known && state.value.userId !== null), observe, change, updated, assertCurrent }
}
