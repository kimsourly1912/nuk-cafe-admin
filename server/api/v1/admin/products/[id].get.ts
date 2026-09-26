import { getProduct } from '../../../../features/menu/products'

export default defineEventHandler(async (event) => {
  await requireStaff(event, 'menu.read')
  return getProduct(useDb(), idParam(getRouterParam(event, 'id'), 'The menu item'))
})
