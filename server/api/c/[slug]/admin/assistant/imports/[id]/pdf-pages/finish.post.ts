import { finishAssistantPdfSchema } from '#shared/contracts/assistant-import'
import { finishImportPdf } from '#server/features/assistant'

export default defineEventHandler(async (event) => {
  const actor = await requireAssistantImport(event)
  const id = readIdParam(event, 'id', 'This import source')
  const command = await readAssistantReviewBody(event, finishAssistantPdfSchema)
  return finishImportPdf(useDb(), actor, id, command)
})
