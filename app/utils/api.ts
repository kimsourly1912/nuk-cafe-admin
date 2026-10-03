import type { ApiFetch, ApiFetchOptions } from './api-fetch'
import { ApiError } from './api-error'
import { apiPath } from './api-path'

let client: ApiFetch | undefined
let tenantOf: (() => string) | undefined

/**
 * Set once by plugins/api.ts: the fetch, and the cafe the app works in (D140; read there, inside
 * Nuxt's context, since `apiFetch` also runs from click handlers outside it).
 */
export function configureApi(fetch: ApiFetch, tenant: () => string) {
  client = fetch
  tenantOf = tenant
}

/**
 * Calls our API (`/api` + `path`; a cafe's surfaces under its address, `apiPath`). Resolves to the
 * response body; throws `ApiError`. Contracts (request and response types) are in `shared/contracts/`.
 *
 * @example
 * const staff = await apiFetch<Page<StaffMember>>('/admin/staff', { query: { page: 1 } })
 * await apiFetch<MenuCategory>(`/admin/menu/categories/${id}`, { method: 'PATCH', body: { version, name } })
 */
export function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  // Rendering on the server runs inside the page request's context, so its config is at hand.
  if (import.meta.server) return serverFetch<T>(apiPath(path, useRuntimeConfig().public.defaultTenant), options)
  if (!client || !tenantOf) throw new Error('apiFetch was called before plugins/api.ts configured it.')
  return client<T>(apiPath(path, tenantOf()), options)
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
