import type { ApiEnvelope } from './api-error'

/**
 * Awaits a generated SDK call and returns the envelope's `data`.
 * Errors are already thrown as `ApiError` by the API plugin.
 *
 * @example
 * const page = await unwrap(getCategoriesPage({ query: { page: 0 } }))
 */
export async function unwrap<T>(request: Promise<{ data: ApiEnvelope<T> }>): Promise<T> {
  const { data: envelope } = await request
  return envelope.data as T
}
