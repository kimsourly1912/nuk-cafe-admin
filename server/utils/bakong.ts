import type { H3Event } from 'h3'
import type { BakongClient } from '#server/features/orders'
import { bakongClient } from '#server/features/orders'

/**
 * The Bakong client from runtime config (step 10.15b, D131): `NUXT_BAKONG_TOKEN`, a Worker secret
 * set by the owner, and `NUXT_BAKONG_API_URL`. `null` without a token: the counter's KHQR is then
 * confirmed by hand, as before.
 */
export function useBakong(event: H3Event): BakongClient | null {
  const { bakong } = useRuntimeConfig(event)
  const token = bakong.token.trim()
  return token ? bakongClient({ apiUrl: bakong.apiUrl, token }) : null
}
