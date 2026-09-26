import { productMenuQuery } from '#shared/contracts/menu'
import { listMenu } from '../../../../features/menu/products'

/** The whole filtered menu (not paginated, capped), for the grid grouped by category. */
export default defineEventHandler(async (event) => {
  await requireStaff(event, 'menu.read')
  return listMenu(useDb(), readQueryAs(event, productMenuQuery))
})
