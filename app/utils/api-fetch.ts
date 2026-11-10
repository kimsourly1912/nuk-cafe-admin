import type { $Fetch, FetchOptions } from 'ofetch'
import { API_ERROR_MESSAGES, ApiError } from './api-error'

export type ApiFetchOptions = Omit<FetchOptions<'json'>, 'retry' | 'baseURL'> & {
  /** A superseded session read must not change auth state, even when it fails with 401. */
  isCurrent?: () => boolean
  /**
   * The answer is the same for every identity (public settings such as the sign-in providers): kept
   * across a session change instead of discarded. A sign-in page opened by a sign-out starts its
   * reads before the old identity is cleared (`leaveSignedOut`). Never for anything identity-bound.
   */
  anyIdentity?: boolean
}
export type ApiFetch = <T>(path: string, options?: ApiFetchOptions) => Promise<T>

interface CreateApiFetchOptions {
  /** Base ofetch instance (`baseURL: '/api'`, timeout). */
  baseFetch: $Fetch
  /**
   * Called when a response says the session is gone (401) or no longer grants admin access
   * (403 NOT_ADMIN). `useAuth().clearSession()`: idempotent.
   */
  onSessionLost: () => void
  /**
   * Called when a response says the account must change its temporary password first
   * (403 PASSWORD_CHANGE_REQUIRED). `useAuth().requirePasswordChange()`.
   */
  onPasswordChangeRequired?: () => void
  /**
   * Identity generation: changes on login, logout, expiry and account change (`useAuth`).
   * A response to a request started in an older generation is discarded (silent `aborted` error),
   * so it can't show or change data in another user's session.
   */
  sessionGeneration?: () => number
  /**
   * Called when a dangerous change needs the password again (403 `CONFIRMATION_REQUIRED`, D246):
   * shows "Confirm it's you" and resolves `true` once confirmed, `false` when cancelled. Confirmed,
   * the same request is sent **once** more (same body, idempotency key and version); cancelled, it
   * fails silently (`aborted`), leaving the form as it was.
   */
  onConfirmationRequired?: () => Promise<boolean>
}

/** The server's code for "confirm your password first" (D246). */
export const CONFIRMATION_REQUIRED = 'CONFIRMATION_REQUIRED'

/**
 * Wraps ofetch for our API (docs/reference/api-client.md):
 * - every failure is thrown as `ApiError` (HTTP errors, network failures, timeouts);
 * - no hidden retries (`retry: 0`): a retried write could apply twice;
 * - Better Auth keeps the session cookie fresh itself, so there is no token refresh: a 401 means
 *   the session is over;
 * - responses from a previous identity are discarded.
 */
export function createApiFetch({ baseFetch, onSessionLost, onPasswordChangeRequired, sessionGeneration = () => 0, onConfirmationRequired }: CreateApiFetchOptions): ApiFetch {
  async function send<T>(path: string, options: ApiFetchOptions | undefined, generation: number, mayAsk: boolean): Promise<T> {
    const stale = () => new ApiError(API_ERROR_MESSAGES.aborted, {
      kind: 'aborted',
      status: 0,
      detail: `Response to ${path} discarded: the session changed while it was in flight.`,
    })
    const changed = () => !options?.anyIdentity && sessionGeneration() !== generation
    let data: T
    try {
      const { isCurrent: _isCurrent, anyIdentity: _anyIdentity, ...fetchOptions } = options ?? {}
      data = await baseFetch<T>(path, { ...fetchOptions, retry: 0 } as FetchOptions<'json'>)
    }
    catch (error) {
      if (changed() || options?.isCurrent?.() === false) throw stale()
      const apiError = ApiError.from(error)
      if (apiError.kind === 'unauthorized' || apiError.code === 'NOT_ADMIN') onSessionLost()
      else if (apiError.code === 'PASSWORD_CHANGE_REQUIRED') onPasswordChangeRequired?.()
      else if (apiError.code === CONFIRMATION_REQUIRED && mayAsk && onConfirmationRequired) {
        const confirmed = await onConfirmationRequired()
        if (sessionGeneration() !== generation) throw stale()
        if (!confirmed) {
          throw new ApiError(API_ERROR_MESSAGES.aborted, { kind: 'aborted', status: 0, detail: `${path}: the password wasn't confirmed, so nothing was sent again.` })
        }
        // Once: a second refusal is shown as it is, never another dialog.
        return send<T>(path, options, generation, false)
      }
      throw apiError
    }
    if (changed() || options?.isCurrent?.() === false) throw stale()
    return data
  }

  return function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
    return send<T>(path, options, sessionGeneration(), true)
  }
}
