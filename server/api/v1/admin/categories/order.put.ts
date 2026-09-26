import { reorderCategoriesBody } from '#shared/contracts/menu'
import { reorderCategories } from '../../../../features/menu/categories'

export default defineEventHandler(async (event) => {
  const staff = await requireStaff(event, 'menu.write')
  return reorderCategories(useDb(), staff, await readBodyAs(event, reorderCategoriesBody))
})
