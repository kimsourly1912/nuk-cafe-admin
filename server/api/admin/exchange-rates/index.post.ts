import { setExchangeRateSchema } from '#shared/contracts/orders'
import { setExchangeRate } from '~~/server/features/orders'

/** `{ khrPerUsd }`: the riel rate from now on; earlier ones stay in the history (D101). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { settings: ['manage'] })
  return setExchangeRate(useDb(), actor, await readValidBody(event, setExchangeRateSchema))
})
