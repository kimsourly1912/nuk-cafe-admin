import { optionVersionSchema } from '#shared/contracts/menu-options'
import { restoreOptionValue } from '~~/server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const setId = readIdParam(event, 'setId', 'This option set')
  const valueId = readIdParam(event, 'valueId', 'This option value')
  return restoreOptionValue(useDb(), actor, setId, valueId, await readValidBody(event, optionVersionSchema))
})
