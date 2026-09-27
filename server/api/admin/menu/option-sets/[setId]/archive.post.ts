import { optionVersionSchema } from '#shared/contracts/menu-options'
import { archiveOptionSet } from '~~/server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'setId', 'This option set')
  return archiveOptionSet(useDb(), actor, id, await readValidBody(event, optionVersionSchema))
})
