import { getPublicExploreLayout } from '#server/features/branches'
import { notFound } from '#server/utils/errors'

/** The opted-in branch's drawing, with no private dining records or staff metadata. */
export default defineEventHandler(async (event) => {
  const tenant = await requireTenant(event)
  if (!useRuntimeConfig(event).public.explore) throw notFound('This branch')
  const branchId = readIdParam(event, 'branchId', 'This branch')
  setHeader(event, 'Cache-Control', 'no-store')
  return getPublicExploreLayout(useDb(), tenant.id, branchId)
})
