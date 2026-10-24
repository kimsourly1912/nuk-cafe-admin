import { modifierVersionSchema } from '#shared/contracts/menu-modifiers'
import { deleteModifierGroup } from '#server/features/menu'

/** `{ version }`: deletes an archived group and its add-ons that no item uses (D200); else 409. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'groupId', 'This add-on group')
  await deleteModifierGroup(useDb(), actor, id, await readValidBody(event, modifierVersionSchema))
  setResponseStatus(event, 204)
  return null
})
