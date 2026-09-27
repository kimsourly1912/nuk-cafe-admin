import { updateModifierSchema } from '#shared/contracts/menu-modifiers'
import { updateModifier } from '~~/server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const groupId = readIdParam(event, 'groupId', 'This add-on group')
  const modifierId = readIdParam(event, 'modifierId', 'This add-on')
  return updateModifier(useDb(), actor, groupId, modifierId, await readValidBody(event, updateModifierSchema))
})
