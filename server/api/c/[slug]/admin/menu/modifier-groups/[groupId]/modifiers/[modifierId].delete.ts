import { modifierVersionSchema } from '#shared/contracts/menu-modifiers'
import { deleteModifier } from '#server/features/menu'

/** `{ version }` (the group's): deletes an archived add-on no item prices (D200); else 409. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const groupId = readIdParam(event, 'groupId', 'This add-on group')
  const modifierId = readIdParam(event, 'modifierId', 'This add-on')
  return deleteModifier(useDb(), actor, groupId, modifierId, await readValidBody(event, modifierVersionSchema))
})
