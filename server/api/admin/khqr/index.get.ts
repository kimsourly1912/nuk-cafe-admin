import { getKhqrSettings } from '#server/features/orders'

/** The KHQR settings: the Bakong account that receives the money and what customers see (D130). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { settings: ['manage'] })
  return getKhqrSettings(useDb(), actor.tenantId, bakongStatus(event))
})
