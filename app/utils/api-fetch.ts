import type { $Fetch, FetchOptions, FetchResponse } from 'ofetch'
import { ApiError, isApiEnvelope } from './api-error'

/** Endpoints that must never trigger a token refresh (they are the auth flow itself). */
const AUTH_PATHS = ['/staff/auth/login', '/staff/auth/refresh', '/staff/auth/logout']

interface CreateApiFetchOptions {
  /** Base ofetch instance (baseURL + `credentials: 'include'`). */
  baseFetch: $Fetch
  /** Called when the session cannot be refreshed. */
  onSessionExpired: () => void
}

/**
 * Wraps ofetch with the backend's conventions. The generated SDK calls `.raw()`.
 * - Throws `ApiError` (classified by `kind`) for HTTP errors, for `{ success: false }` bodies
 *   sent with HTTP 200, and for network failures/timeouts.
 * - On an unauthorized error (HTTP 401 or code NC1000), calls `/staff/auth/refresh` once
 *   (shared by concurrent requests), then retries.
 *   Tokens live in HttpOnly cookies, so there is nothing to attach manually.
 */
export function createApiFetch({ baseFetch, onSessionExpired }: CreateApiFetchOptions): $Fetch {
  let refreshing: Promise<boolean> | null = null

  function refreshSession() {
    refreshing ??= send('/staff/auth/refresh', { method: 'POST' })
      .then(() => true, () => false)
      .finally(() => {
        refreshing = null
      })
    return refreshing
  }

  async function send(url: string, options?: FetchOptions): Promise<FetchResponse<unknown>> {
    let response: FetchResponse<unknown>
    try {
      response = await baseFetch.raw(url, { ...options, ignoreResponseError: true } as FetchOptions<'json'>)
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

  async function raw(url: string, options?: FetchOptions) {
    try {
      return await send(url, options)
    }
    catch (error) {
      const isAuthPath = AUTH_PATHS.some(path => url.includes(path))
      // `kind` covers both HTTP 401 and an unauthorized code sent with HTTP 200.
      if (!(error instanceof ApiError) || error.kind !== 'unauthorized' || isAuthPath) throw error

      if (await refreshSession()) return send(url, options)
      onSessionExpired()
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
