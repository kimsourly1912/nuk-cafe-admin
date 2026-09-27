import { productListQuery } from '#shared/contracts/menu'
import { listProducts } from '../../../../legacy/menu/products'

export default defineEventHandler(async (event) => {
  await requireStaff(event, 'menu.read')
  return listProducts(useDb(), readValidQuery(event, productListQuery))
})
