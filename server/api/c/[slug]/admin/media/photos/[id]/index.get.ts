import { photoForEdit } from '#server/features/media'

/** A photo for the photo editor (D158): how it was made (`null` before D158) and its files. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { media: ['upload'] })
  return photoForEdit(useDb(), actor.tenantId, readIdParam(event, 'id', 'This photo'))
})
