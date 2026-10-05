import { extractAssistantImportSchema } from '#shared/contracts/assistant-import'
import { extractImportSource } from '#server/features/assistant'

export default defineEventHandler(async (event) => {
  const actor = await requireAssistantImport(event)
  const id = readIdParam(event, 'id', 'This import source')
  const { version } = await readAssistantReviewBody(event, extractAssistantImportSchema)
  return extractImportSource(useDb(), blob, actor, id, version, () => assistantImportModel(event), event.web?.request?.signal)
})
