import { updateProductBody } from '#shared/contracts/menu'
import { updateProduct } from '../../../../legacy/menu/products'

export default defineEventHandler(async (event) => {
  const staff = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'id', 'The menu item')
  return updateProduct(useDb(), staff, id, await readValidBody(event, updateProductBody))
})
