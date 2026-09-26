import { productListQuery } from '#shared/contracts/menu'
import { listProducts } from '../../../../features/menu/products'

export default defineEventHandler(async (event) => {
  await requireStaff(event, 'menu.read')
  return listProducts(useDb(), readQueryAs(event, productListQuery))
})
