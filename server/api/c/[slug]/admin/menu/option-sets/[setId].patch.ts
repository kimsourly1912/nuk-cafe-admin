import { renameOptionSetSchema } from '#shared/contracts/menu-options'
import { renameOptionSet } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'setId', 'This option set')
  return renameOptionSet(useDb(), actor, id, await readValidBody(event, renameOptionSetSchema))
})
