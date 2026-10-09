import { bakongTokenSchema } from '#shared/contracts/orders'
import { saveBakongToken } from '#server/features/orders'

/** `{ version, token }`: saves or replaces the cafe's Bakong token, sealed (T2d, D148). Answers the settings, never the token. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { settings: ['manage'] })
  return saveBakongToken(useDb(), actor, await readValidBody(event, bakongTokenSchema), bakongSetup(event))
})
