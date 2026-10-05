import { getImportReview } from '#server/features/assistant'

export default defineEventHandler(async (event) => {
  const actor = await requireAssistantImport(event)
  return getImportReview(useDb(), actor, readIdParam(event, 'id', 'This import source'))
})
