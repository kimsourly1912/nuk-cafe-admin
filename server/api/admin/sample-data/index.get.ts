import { getSampleDataState } from '#server/features/sample-data'

/** `GET /api/admin/sample-data`: what exists and how far a sample menu load got (D94). */
export default defineEventHandler(async (event) => {
  const { environment } = await requireSampleData(event)
  return getSampleDataState(useDb(), environment)
})
