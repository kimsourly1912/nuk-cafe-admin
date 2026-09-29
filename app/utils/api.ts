import type { ApiFetch, ApiFetchOptions } from './api-fetch'
import { ApiError } from './api-error'

let client: ApiFetch | undefined

/** Set once by plugins/api.ts. */
export function configureApi(fetch: ApiFetch) {
  client = fetch
}

/**
 * Calls our API (`/api` + `path`). Resolves to the response body; throws `ApiError`.
 * Contracts (request and response types) are in `shared/contracts/`.
 *
 * @example
 * const staff = await apiFetch<Page<StaffMember>>('/admin/staff', { query: { page: 1 } })
 * await apiFetch<MenuCategory>(`/admin/menu/categories/${id}`, { method: 'PATCH', body: { version, name } })
 */
export function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  if (import.meta.server) return serverFetch<T>(path, options)
  if (!client) throw new Error('apiFetch was called before plugins/api.ts configured it.')
  return client<T>(path, options)
}

/**
 * While rendering the customer site on the server (D95): a fetch for this page request only (a
 * module-level client would be shared by every request the server handles), calling our API
 * in-process. No session handling: the customer site reads public routes. Errors are `ApiError`s,
 * like in the browser.
 */
async function serverFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  const fetch = useRequestFetch()
  try {
    return await fetch<T>(`/api${path}`, { ...options, retry: 0, timeout: 30_000 } as Parameters<typeof fetch>[1]) as T
  }
  catch (error) {
    throw ApiError.from(error)
  }
}
