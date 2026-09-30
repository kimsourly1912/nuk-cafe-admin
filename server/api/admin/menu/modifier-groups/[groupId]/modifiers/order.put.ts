import { reorderModifiersSchema } from '#shared/contracts/menu-modifiers'
import { reorderModifiers } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'groupId', 'This add-on group')
  return reorderModifiers(useDb(), actor, id, await readValidBody(event, reorderModifiersSchema))
})
