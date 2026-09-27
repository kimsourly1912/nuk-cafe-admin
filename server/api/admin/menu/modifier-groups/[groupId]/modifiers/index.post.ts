import { addModifierSchema } from '#shared/contracts/menu-modifiers'
import { addModifier } from '~~/server/features/menu'

/** Adds an add-on at the end of the group; returns the whole group. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'groupId', 'This add-on group')
  const group = await addModifier(useDb(), actor, id, await readValidBody(event, addModifierSchema))
  setResponseStatus(event, 201)
  return group
})
