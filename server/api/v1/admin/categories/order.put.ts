import { reorderCategoriesBody } from '#shared/contracts/menu'
import { reorderCategories } from '../../../../legacy/menu/categories'

export default defineEventHandler(async (event) => {
  const staff = await requireStaff(event, 'menu.write')
  return reorderCategories(useDb(), staff, await readValidBody(event, reorderCategoriesBody))
})
