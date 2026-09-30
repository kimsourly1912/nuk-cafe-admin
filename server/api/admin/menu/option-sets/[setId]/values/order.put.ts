import { reorderOptionValuesSchema } from '#shared/contracts/menu-options'
import { reorderOptionValues } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'setId', 'This option set')
  return reorderOptionValues(useDb(), actor, id, await readValidBody(event, reorderOptionValuesSchema))
})
