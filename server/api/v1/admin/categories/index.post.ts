import { createCategoryBody } from '#shared/contracts/menu'
import { createCategory } from '../../../../features/menu/categories'

export default defineEventHandler(async (event) => {
  const staff = await requireStaff(event, 'menu.write')
  const input = await readBodyAs(event, createCategoryBody)
  const category = await createCategory(useDb(), staff, input)
  setResponseStatus(event, 201)
  return category
})
