import { removeBakongTokenSchema } from '#shared/contracts/orders'
import { removeBakongToken } from '#server/features/orders'

/** `{ version }`: removes the cafe's Bakong token; the counter's check turns off (T2d, D148). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { settings: ['manage'] })
  return removeBakongToken(useDb(), actor, await readValidBody(event, removeBakongTokenSchema), bakongSetup(event))
})
