import { updateCategoryBody } from '#shared/contracts/menu'
import { updateCategory } from '../../../../features/menu/categories'

export default defineEventHandler(async (event) => {
  const staff = await requireStaff(event, 'menu.write')
  const id = idParam(getRouterParam(event, 'id'), 'The category')
  return updateCategory(useDb(), staff, id, await readBodyAs(event, updateCategoryBody))
})
