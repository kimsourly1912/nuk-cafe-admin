import type { H3Event } from 'h3'
import type { ReadObject } from '#server/features/marketing'

/**
 * Route glue for marketing posts (M2a, D164): the poster read from the cafe's stored images (R2 on
 * Cloudflare), and the address a post's Order now button opens.
 */
export const readStoredObject: ReadObject = async (key) => {
  const object = await blob.get(key)
  return object ? new Uint8Array(await object.arrayBuffer()) : null
}

/** The cafe's menu address from the request's cafe (`/api/c/<slug>/…`). */
export function requestCafeUrl(event: H3Event): string | undefined {
  const slug = getRouterParam(event, 'slug')
  return slug ? cafeSiteUrl(slug) : undefined
}
