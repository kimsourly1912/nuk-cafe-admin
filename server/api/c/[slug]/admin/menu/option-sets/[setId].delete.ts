import { optionVersionSchema } from '#shared/contracts/menu-options'
import { deleteOptionSet } from '#server/features/menu'

/** `{ version }`: deletes an archived set and its values that no item uses (D200); else 409. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const id = readIdParam(event, 'setId', 'This option set')
  await deleteOptionSet(useDb(), actor, id, await readValidBody(event, optionVersionSchema))
  setResponseStatus(event, 204)
  return null
})
