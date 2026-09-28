import type { ApiFetch, ApiFetchOptions } from './api-fetch'

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
  if (!client) throw new Error('apiFetch was called before plugins/api.ts configured it.')
  return client<T>(path, options)
}
