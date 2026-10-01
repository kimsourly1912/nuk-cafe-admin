import { getOptionSet } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  await requirePermission(event, { menu: ['read'] })
  return getOptionSet(useDb(), readIdParam(event, 'setId', 'This option set'))
})
