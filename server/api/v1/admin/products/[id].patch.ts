import { updateProductBody } from '#shared/contracts/menu'
import { updateProduct } from '../../../../features/menu/products'

export default defineEventHandler(async (event) => {
  const staff = await requireStaff(event, 'menu.write')
  const id = idParam(getRouterParam(event, 'id'), 'The menu item')
  return updateProduct(useDb(), staff, id, await readBodyAs(event, updateProductBody))
})
