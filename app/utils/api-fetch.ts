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
 * - Throws `ApiError` for HTTP errors and for `{ success: false }` bodies (sent with HTTP 200).
 * - On 401, calls `/staff/auth/refresh` once (shared by concurrent requests), then retries.
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

    const body: unknown = response._data
    if (!response.ok) {
      throw isApiEnvelope(body)
        ? ApiError.fromEnvelope(body, response.status)
        : new ApiError(response.statusText || `HTTP ${response.status}`, { status: response.status })
    }
    if (isApiEnvelope(body) && body.success === false) throw ApiError.fromEnvelope(body, response.status)
    return response
  }

  async function raw(url: string, options?: FetchOptions) {
    try {
      return await send(url, options)
    }
    catch (error) {
      const isAuthPath = AUTH_PATHS.some(path => url.includes(path))
      if (!(error instanceof ApiError) || error.status !== 401 || isAuthPath) throw error

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
