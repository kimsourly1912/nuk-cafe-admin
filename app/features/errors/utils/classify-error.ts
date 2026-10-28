import { CAFE_NOT_FOUND, TENANT_SUSPENDED } from '#shared/contracts/cafe'

export type ErrorKind = 'cafe-not-found' | 'cafe-paused' | 'page-not-found' | 'generic'

/**
 * The `code` of a server error's `data`. Nuxt hands that over as JSON text after a server render,
 * as an object otherwise.
 */
function errorCode(data: unknown): unknown {
  let parsed = data
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data)
    }
    catch {
      return undefined
    }
  }
  return parsed && typeof parsed === 'object' && 'code' in parsed ? parsed.code : undefined
}

/**
 * Which error page to show (D143). A cafe that isn't there or is paused needs a cafe in the address;
 * any other 404 is an unknown page. Add a new kind here, with its words in `errorCopy` and its view
 * in `ErrorView.vue`.
 */
export function classifyError(error: { statusCode?: number, data?: unknown }, slug: string | undefined): ErrorKind {
  const code = errorCode(error.data)
  if (slug && code === CAFE_NOT_FOUND) return 'cafe-not-found'
  if (slug && code === TENANT_SUSPENDED) return 'cafe-paused'
  return error.statusCode === 404 ? 'page-not-found' : 'generic'
}
