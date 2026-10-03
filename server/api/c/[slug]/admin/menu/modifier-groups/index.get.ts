import { modifierGroupListQuerySchema } from '#shared/contracts/menu-modifiers'
import { listModifierGroups } from '#server/features/menu'

/** The Add-ons library, by name (`?status=active|archived|all`, default active). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['read'] })
  return listModifierGroups(useDb(), actor.tenantId, readValidQuery(event, modifierGroupListQuerySchema))
})
