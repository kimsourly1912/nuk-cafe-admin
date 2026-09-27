import { updateCategoryBody } from '#shared/contracts/menu'
import { updateCategory } from '../../../../legacy/menu/categories'

export default defineEventHandler(async (event) => {
  const staff = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'id', 'The category')
  return updateCategory(useDb(), staff, id, await readValidBody(event, updateCategoryBody))
})
