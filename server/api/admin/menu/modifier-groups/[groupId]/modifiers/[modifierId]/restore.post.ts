import { modifierVersionSchema } from '#shared/contracts/menu-modifiers'
import { restoreModifier } from '~~/server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const groupId = readIdParam(event, 'groupId', 'This add-on group')
  const modifierId = readIdParam(event, 'modifierId', 'This add-on')
  return restoreModifier(useDb(), actor, groupId, modifierId, await readValidBody(event, modifierVersionSchema))
})
