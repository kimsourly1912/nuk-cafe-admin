import { optionSetListQuerySchema } from '#shared/contracts/menu-options'
import { listOptionSets } from '#server/features/menu'

/** The Options library, by name (`?status=active|archived|all`, default active). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['read'] })
  return listOptionSets(useDb(), actor.tenantId, readValidQuery(event, optionSetListQuerySchema))
})
