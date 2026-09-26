import type { $Fetch, FetchOptions } from 'ofetch'
import { API_ERROR_MESSAGES, ApiError } from './api-error'

export type ApiFetchOptions = Omit<FetchOptions<'json'>, 'retry' | 'baseURL'>
export type ApiFetch = <T>(path: string, options?: ApiFetchOptions) => Promise<T>

interface CreateApiFetchOptions {
  /** Base ofetch instance (`baseURL: '/api/v1'`, timeout). */
  baseFetch: $Fetch
  /**
   * Called when a response says the session is gone (401) or no longer grants staff access
   * (403 NOT_STAFF: the account was disabled). `useAuth().clearSession()`: idempotent.
   */
  onSessionLost: () => void
  /**
   * Identity generation: changes on login, logout, expiry and account change (`useAuth`).
   * A response to a request started in an older generation is discarded (silent `aborted` error),
   * so it can't show or change data in another user's session.
   */
  sessionGeneration?: () => number
}

/**
 * Wraps ofetch for our API (docs/reference/api-client.md):
 * - every failure is thrown as `ApiError` (HTTP errors, network failures, timeouts);
 * - no hidden retries (`retry: 0`): a retried write could apply twice;
 * - Better Auth keeps the session cookie fresh itself, so there is no token refresh: a 401 means
 *   the session is over;
 * - responses from a previous identity are discarded.
 */
export function createApiFetch({ baseFetch, onSessionLost, sessionGeneration = () => 0 }: CreateApiFetchOptions): ApiFetch {
  return async function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
    const generation = sessionGeneration()
    const stale = () => new ApiError(API_ERROR_MESSAGES.aborted, {
      kind: 'aborted',
      status: 0,
      detail: `Response to ${path} discarded: the session changed while it was in flight.`,
    })
    let data: T
    try {
      data = await baseFetch<T>(path, { ...options, retry: 0 } as FetchOptions<'json'>)
    }
    catch (error) {
      if (sessionGeneration() !== generation) throw stale()
      const apiError = ApiError.from(error)
      if (apiError.kind === 'unauthorized' || apiError.code === 'NOT_STAFF') onSessionLost()
      throw apiError
    }
    if (sessionGeneration() !== generation) throw stale()
    return data
  }
}
