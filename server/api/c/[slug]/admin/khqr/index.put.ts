import { khqrSettingsSchema } from '#shared/contracts/orders'
import { saveKhqrSettings } from '#server/features/orders'

/** `{ version, enabled, accountId, merchantName, merchantCity, currencies }`: saves the KHQR settings (D130). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { settings: ['manage'] })
  return saveKhqrSettings(useDb(), actor, await readValidBody(event, khqrSettingsSchema), new Date(), bakongStatus(event))
})
