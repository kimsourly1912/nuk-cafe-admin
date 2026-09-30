import { getExchangeRates } from '#server/features/orders'

/** The riel rate in force and the latest changes (D101). */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { settings: ['manage'] })
  return getExchangeRates(useDb())
})
