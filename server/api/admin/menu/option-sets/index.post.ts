import { createOptionSetSchema } from '#shared/contracts/menu-options'
import { createOptionSet } from '#server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const input = await readValidBody(event, createOptionSetSchema)
  const set = await createOptionSet(useDb(), actor, input)
  setResponseStatus(event, 201)
  return set
})
