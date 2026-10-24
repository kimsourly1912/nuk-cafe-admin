import { optionVersionSchema } from '#shared/contracts/menu-options'
import { deleteOptionValue } from '#server/features/menu'

/** `{ version }` (the set's): deletes an archived value no item version uses (D200); else 409. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const setId = readIdParam(event, 'setId', 'This option set')
  const valueId = readIdParam(event, 'valueId', 'This option value')
  return deleteOptionValue(useDb(), actor, setId, valueId, await readValidBody(event, optionVersionSchema))
})
