import { loadSampleMenuSchema } from '#shared/contracts/sample-data'
import { loadSampleMenuStep } from '~~/server/features/sample-data'

/** `POST /api/admin/sample-data/menu` `{ size }`: the next step of the sample menu (D94). */
export default defineEventHandler(async (event) => {
  const { actor, environment } = await requireSampleData(event)
  return loadSampleMenuStep(useDb(), actor, await readValidBody(event, loadSampleMenuSchema), environment)
})
