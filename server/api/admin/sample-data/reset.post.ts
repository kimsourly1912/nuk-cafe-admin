import { resetSampleMenuSchema } from '#shared/contracts/sample-data'
import { resetSampleMenu } from '#server/features/sample-data'

/** `POST /api/admin/sample-data/reset` `{ confirm: 'RESET' }`: delete every menu record and upload (D94). */
export default defineEventHandler(async (event) => {
  const { actor, environment } = await requireSampleData(event)
  await readValidBody(event, resetSampleMenuSchema)
  return resetSampleMenu(useDb(), actor, blob, environment)
})
