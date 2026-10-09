import { testBakongConnection } from '#server/features/orders'

/** Payments → KHQR → Test connection (10.15b D131): whether this cafe's token gets an answer from Bakong (D148). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { settings: ['manage'] })
  return testBakongConnection(await useBakong(event, actor.tenantId))
})
