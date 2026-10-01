import { createModifierGroupSchema } from '#shared/contracts/menu-modifiers'
import { createModifierGroup } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const group = await createModifierGroup(useDb(), actor, await readValidBody(event, createModifierGroupSchema))
  setResponseStatus(event, 201)
  return group
})
