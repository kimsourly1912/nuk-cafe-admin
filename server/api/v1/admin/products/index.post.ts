import { createProductBody } from '#shared/contracts/menu'
import { createProduct } from '../../../../features/menu/products'

export default defineEventHandler(async (event) => {
  const staff = await requireStaff(event, 'menu.write')
  const input = await readBodyAs(event, createProductBody)
  const product = await createProduct(useDb(), staff, input)
  setResponseStatus(event, 201)
  return product
})
