import { updateBranchSettingsSchema } from '#shared/contracts/branches'
import { updateBranchSettings } from '~~/server/features/branches'

/** Saves the branch's details and/or hours from the version read. Hours are a setting (security.md). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { branch: ['update'] })
  const id = readIdParam(event, 'branchId', 'This branch')
  const input = await readValidBody(event, updateBranchSettingsSchema)
  if (input.hours) await requirePermission(event, { settings: ['manage'] })
  return updateBranchSettings(useDb(), actor, id, input)
})
