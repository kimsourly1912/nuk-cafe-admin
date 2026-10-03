import { updateModifierGroupSchema } from '#shared/contracts/menu-modifiers'
import { updateModifierGroup } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'groupId', 'This add-on group')
  return updateModifierGroup(useDb(), actor, id, await readValidBody(event, updateModifierGroupSchema))
})
