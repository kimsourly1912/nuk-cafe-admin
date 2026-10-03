import { testBakongConnection } from '#server/features/orders'

/** Payments → KHQR → Test connection (step 10.15b, D131): whether this server can ask Bakong with its token. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { settings: ['manage'] })
  return testBakongConnection(useBakong(event))
})
