import { addOptionValueSchema } from '#shared/contracts/menu-options'
import { addOptionValue } from '~~/server/features/menu'

/** Adds a value at the end of the set; returns the whole set. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'setId', 'This option set')
  const set = await addOptionValue(useDb(), actor, id, await readValidBody(event, addOptionValueSchema))
  setResponseStatus(event, 201)
  return set
})
