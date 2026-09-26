import { categoryListQuery } from '#shared/contracts/menu'
import { listCategories } from '../../../../features/menu/categories'

/** Every category (not paginated: the list is small), in sort order. `?level=main|sub` narrows it. */
export default defineEventHandler(async (event) => {
  await requireStaff(event, 'menu.read')
  return listCategories(useDb(), readQueryAs(event, categoryListQuery))
})
