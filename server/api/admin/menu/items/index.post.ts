import { createItemSchema } from '#shared/contracts/menu-items'
import { createItem } from '~~/server/features/menu'

/** A new item, as a draft. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  const item = await createItem(useDb(), actor, await readValidBody(event, createItemSchema))
  setResponseStatus(event, 201)
  return item
})
