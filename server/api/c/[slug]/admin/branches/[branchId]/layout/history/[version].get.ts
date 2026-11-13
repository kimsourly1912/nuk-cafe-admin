import * as v from 'valibot'
import { getLayoutSnapshot } from '#server/features/branches'

const versionSchema = v.pipe(v.string(), v.regex(/^[1-9]\d{0,8}$/), v.transform(Number))

/** One version of the layout (ISS-027), to restore in the editor: its floors, placements, scene and pages. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { branch: ['update'] })
  const branchId = readIdParam(event, 'branchId', 'This branch')
  const version = v.safeParse(versionSchema, getRouterParam(event, 'version'))
  if (!version.success) throw apiError(404, ErrorCodes.NOT_FOUND, 'This version was not found.')
  return getLayoutSnapshot(useDb(), actor.tenantId, branchId, version.output)
})
