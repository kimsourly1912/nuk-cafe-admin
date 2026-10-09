import type { H3Event } from 'h3'
import type { BakongClient, BakongSetup } from '#server/features/orders'
import { tenantBakongClient } from '#server/features/orders'

/**
 * The server's side of Bakong (T2d, D148): `NUXT_BAKONG_API_URL` and `NUXT_BAKONG_ENCRYPTION_KEY`, the
 * key that seals each cafe's token in the database. The tokens themselves are the cafes' own.
 */
export function bakongSetup(event?: H3Event): BakongSetup {
  const { bakong } = useRuntimeConfig(event)
  return { apiUrl: bakong.apiUrl, encryptionKey: bakong.encryptionKey }
}

/** Whether this server can store a cafe's token (its key is set). */
export const bakongTokenStorage = (event?: H3Event) => Boolean(bakongSetup(event).encryptionKey.trim())

/** The Bakong client with this cafe's own token; `null` without one: the cashier confirms by hand. */
export function useBakong(event: H3Event, tenantId: string): Promise<BakongClient | null> {
  return tenantBakongClient(useDb(), tenantId, bakongSetup(event))
}
