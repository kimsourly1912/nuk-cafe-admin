import { getProduct } from '../../../../legacy/menu/products'

export default defineEventHandler(async (event) => {
  await requireStaff(event, 'menu.read')
  return getProduct(useDb(), readIdParam(event, 'id', 'The menu item'))
})
