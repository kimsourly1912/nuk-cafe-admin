import { getKhqrSettings } from '#server/features/orders'

/** The KHQR settings (D130) and the cafe's Bakong token as Payments shows it, never the token (D148). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { settings: ['manage'] })
  return getKhqrSettings(useDb(), actor.tenantId, bakongTokenStorage(event))
})
