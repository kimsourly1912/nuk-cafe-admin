import { loadSampleBranchSchema } from '#shared/contracts/sample-data'
import { loadSampleBranch } from '#server/features/sample-data'

/** `POST /api/admin/sample-data/branch` `{ branchId, tablesOnly? }`: sample hours and tables (D94). */
export default defineEventHandler(async (event) => {
  const { actor, environment } = await requireSampleData(event)
  return loadSampleBranch(useDb(), actor, await readValidBody(event, loadSampleBranchSchema), useTableQr(event), environment)
})
