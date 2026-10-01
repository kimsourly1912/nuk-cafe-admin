import { modifierVersionSchema } from '#shared/contracts/menu-modifiers'
import { archiveModifierGroup } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'groupId', 'This add-on group')
  return archiveModifierGroup(useDb(), actor, id, await readValidBody(event, modifierVersionSchema))
})
