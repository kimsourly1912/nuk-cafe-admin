import type { $Fetch, FetchOptions, FetchResponse } from 'ofetch'
import { API_ERROR_MESSAGES, ApiError, isApiEnvelope } from './api-error'

/** Endpoints that must never trigger a token refresh (they are the auth flow itself). */
const AUTH_PATHS = ['/staff/auth/login', '/staff/auth/refresh', '/staff/auth/logout']

/** A hung refresh must not hold every waiting request hostage (normal requests get the SDK's 30 s). */
export const REFRESH_TIMEOUT_MS = 10_000

interface CreateApiFetchOptions {
  /** Base ofetch instance (baseURL + `credentials: 'include'`). */
  baseFetch: $Fetch
  /** Called when the session is definitively gone. At most once per session generation. */
  onSessionExpired: () => void
  /**
   * Identity generation: changes on login, logout, expiry and account change (`useAuth`).
   * A response to a request started in an older generation is discarded (silent `aborted` error),
   * so it can't show or change data in another user's session.
   */
  sessionGeneration?: () => number
}

type RefreshOutcome = { ok: true } | { ok: false, error: ApiError }

/**
 * Wraps ofetch with the backend's conventions. The generated SDK calls `.raw()`.
 * - Throws `ApiError` (classified by `kind`) for HTTP errors, for `{ success: false }` bodies
 *   sent with HTTP 200, and for network failures/timeouts.
 * - Timeouts apply per attempt (the SDK passes 30 s). ofetch's own automatic retries are off, so
 *   the only retry is the single one after a token refresh. Worst case for one call:
 *   30 s + refresh (≤ 10 s) + 30 s.
 * - On an unauthorized error (HTTP 401 or code NC1000): one `/staff/auth/refresh` shared by
 *   concurrent requests, then one retry. Tokens live in HttpOnly cookies, so nothing is attached.
 *   - Refresh rejected, or the retry is still unauthorized → the session expires (once).
 *   - Refresh couldn't complete (network/timeout) → the request fails with that error and the
 *     session is kept: the user can retry, and nobody is logged out by a flaky connection.
 *   - Once expired, further unauthorized errors don't refresh again until the next identity change.
 * Cases and tests: docs/reference/app-behavior.md → "Session loss", test/unit/api-fetch.test.ts.
 */
export function createApiFetch({ baseFetch, onSessionExpired, sessionGeneration = () => 0 }: CreateApiFetchOptions): $Fetch {
  let refreshing: Promise<RefreshOutcome> | null = null
  /** Generation in which the session expired; `undefined` while it's believed valid. */
  let expiredIn: number | undefined

  const isExpired = () => expiredIn === sessionGeneration()

  function expire() {
    if (isExpired()) return
    onSessionExpired()
    // Read after the callback: expiring usually moves to a new (signed-out) generation.
    expiredIn = sessionGeneration()
  }

  function refreshSession() {
    refreshing ??= send('/staff/auth/refresh', { method: 'POST', timeout: REFRESH_TIMEOUT_MS })
      .then((): RefreshOutcome => ({ ok: true }), (error): RefreshOutcome => ({ ok: false, error: ApiError.from(error) }))
      .finally(() => {
        refreshing = null
      })
    return refreshing
  }

  async function send(url: string, options?: FetchOptions): Promise<FetchResponse<unknown>> {
    let response: FetchResponse<unknown>
    try {
      // `retry: 0`: ofetch would retry GETs once, reusing the first attempt's signal (an aborted
      // one after a timeout, or one with no timeout after a network error).
      response = await baseFetch.raw(url, { ...options, retry: 0, ignoreResponseError: true } as FetchOptions<'json'>)
    }
    catch (error) {
      throw ApiError.from(error)
    }

    // The backend reports failures either as HTTP errors or as HTTP 200 + `success: false`.
    const body: unknown = response._data
    const failed = !response.ok || (isApiEnvelope(body) && body.success === false)
    if (failed) throw ApiError.fromResponse(response.status, body)
    return response
  }

  async function withRefresh(url: string, options?: FetchOptions) {
    try {
      return await send(url, options)
    }
    catch (error) {
      const isAuthPath = AUTH_PATHS.some(path => url.includes(path))
      // `kind` covers both HTTP 401 and an unauthorized code sent with HTTP 200.
      if (!(error instanceof ApiError) || error.kind !== 'unauthorized' || isAuthPath) throw error
      if (isExpired()) throw error

      const refreshed = await refreshSession()
      if (!refreshed.ok) {
        const transportFailure = refreshed.error.kind === 'network' || refreshed.error.kind === 'timeout'
        if (transportFailure) throw refreshed.error
        expire()
        throw error
      }

      try {
        return await send(url, options)
      }
      catch (retryError) {
        // Still unauthorized with a fresh token: the session is gone. Never refresh again for it.
        if (retryError instanceof ApiError && retryError.kind === 'unauthorized') expire()
        throw retryError
      }
    }
  }

  async function raw(url: string, options?: FetchOptions) {
    const generation = sessionGeneration()
    const staleSession = () => new ApiError(API_ERROR_MESSAGES.aborted, {
      kind: 'aborted',
      status: 0,
      detail: `Response to ${url} discarded: the session changed while it was in flight.`,
    })
    try {
      const response = await withRefresh(url, options)
      if (sessionGeneration() !== generation) throw staleSession()
      return response
    }
    catch (error) {
      if (sessionGeneration() !== generation) throw staleSession()
      throw error
    }
  }

  const apiFetch = async (url: string, options?: FetchOptions) => (await raw(url, options))._data

  return Object.assign(apiFetch, {
    raw,
    native: baseFetch.native,
    create: baseFetch.create,
  }) as unknown as $Fetch
}
