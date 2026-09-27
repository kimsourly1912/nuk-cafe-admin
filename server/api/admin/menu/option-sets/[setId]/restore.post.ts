import { optionVersionSchema } from '#shared/contracts/menu-options'
import { restoreOptionSet } from '~~/server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'setId', 'This option set')
  return restoreOptionSet(useDb(), actor, id, await readValidBody(event, optionVersionSchema))
})
