import { modifierVersionSchema } from '#shared/contracts/menu-modifiers'
import { restoreModifierGroup } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'groupId', 'This add-on group')
  return restoreModifierGroup(useDb(), actor, id, await readValidBody(event, modifierVersionSchema))
})
