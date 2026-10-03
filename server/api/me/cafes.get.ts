import { listAccountCafes } from '#server/features/tenants'

/**
 * The cafes the signed-in account works in, with the workspaces it may open in each (T2c, D144):
 * Your cafes and the cafe switcher. A platform route: it names no cafe. Not signed in: 401.
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  return listAccountCafes(useDb(), session?.user as Parameters<typeof listAccountCafes>[1])
})
