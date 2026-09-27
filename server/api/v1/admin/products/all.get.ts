import { productMenuQuery } from '#shared/contracts/menu'
import { listMenu } from '../../../../legacy/menu/products'

/** The whole filtered menu (not paginated, capped), for the grid grouped by category. */
export default defineEventHandler(async (event) => {
  await requirePermission(event, { menu: ['read'] })
  return listMenu(useDb(), readValidQuery(event, productMenuQuery))
})
