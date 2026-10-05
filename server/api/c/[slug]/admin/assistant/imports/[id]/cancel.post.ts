import { extractAssistantImportSchema } from '#shared/contracts/assistant-import'
import { cancelImportExtraction } from '#server/features/assistant'

export default defineEventHandler(async (event) => {
  const actor = await requireAssistantImport(event)
  const id = readIdParam(event, 'id', 'This import source')
  const { version } = await readAssistantReviewBody(event, extractAssistantImportSchema)
  return cancelImportExtraction(useDb(), actor, id, version)
})
