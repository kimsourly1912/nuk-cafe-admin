import type { SessionSurface } from './useSessionIdentity'

type WorkspaceSurface = Exclude<SessionSurface, 'account'>
const SESSION_KEYS = { admin: 'staff-session', counter: 'counter-session', platform: 'platform-session' } as const

/** Shared lifecycle only; each feature still owns its authorization and sign-in rules. */
export function useWorkspaceSession<T extends { userId: string }>(surface: WorkspaceSurface, path: string) {
  const key = SESSION_KEYS[surface]
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

  return { user, checked, error, signingOut, generation: identity.generation, setUser, reset, fetchSession, supersede }
}
