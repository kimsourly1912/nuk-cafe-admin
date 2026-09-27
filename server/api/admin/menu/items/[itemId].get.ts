import { getItem } from '~~/server/features/menu'

export default defineEventHandler(async (event) => {
  await requirePermission(event, { menu: ['read'] })
  return getItem(useDb(), readIdParam(event, 'itemId', 'This menu item'))
})
