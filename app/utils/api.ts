import type { ApiFetch, ApiFetchOptions } from './api-fetch'

let client: ApiFetch | undefined

/** Set once by plugins/api.ts. */
export function configureApi(fetch: ApiFetch) {
  client = fetch
}

/**
 * Calls our API (`/api/v1` + `path`). Resolves to the response body; throws `ApiError`.
 * Contracts (request and response types) are in `shared/contracts/`.
 *
 * @example
 * const categories = await apiFetch<Category[]>('/admin/categories')
 * await apiFetch<Category>(`/admin/categories/${id}`, { method: 'PATCH', body: { version, name } })
 */
export function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  if (!client) throw new Error('apiFetch was called before plugins/api.ts configured it.')
  return client<T>(path, options)
}
