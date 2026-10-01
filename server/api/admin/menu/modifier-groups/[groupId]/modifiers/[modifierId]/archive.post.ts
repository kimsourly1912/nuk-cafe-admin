import { modifierVersionSchema } from '#shared/contracts/menu-modifiers'
import { archiveModifier } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const groupId = readIdParam(event, 'groupId', 'This add-on group')
  const modifierId = readIdParam(event, 'modifierId', 'This add-on')
  return archiveModifier(useDb(), actor, groupId, modifierId, await readValidBody(event, modifierVersionSchema))
})
