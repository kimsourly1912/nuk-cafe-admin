import { publicMenuQuerySchema } from '#shared/contracts/public-menu'
import { getPublicMenu } from '~~/server/features/menu'

/**
 * `GET /api/public/menu?branchId=…`: what the branch sells right now, for anyone (D65). Not cached
 * yet: it reads the database every time, so sold-out switches and edits show at once.
 */
export default defineEventHandler(async (event) => {
  return getPublicMenu(useDb(), readValidQuery(event, publicMenuQuerySchema))
})
