import { modifierGroupListQuerySchema } from '#shared/contracts/menu-modifiers'
import { listModifierGroups } from '#server/features/menu'

/** The Add-ons library, by name (`?status=active|archived|all`, default active). */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { menu: ['read'] })
  return listModifierGroups(useDb(), readValidQuery(event, modifierGroupListQuerySchema))
})
