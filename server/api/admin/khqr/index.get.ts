import { getKhqrSettings } from '#server/features/orders'

/** The KHQR settings: the Bakong account that receives the money and what customers see (D130). */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { settings: ['manage'] })
  return getKhqrSettings(useDb(), bakongStatus(event))
})
