import { prepareAssistantPdfSchema } from '#shared/contracts/assistant-import'
import { prepareImportPdf } from '#server/features/assistant'

export default defineEventHandler(async (event) => {
  const actor = await requireAssistantImport(event)
  const id = readIdParam(event, 'id', 'This import source')
  const command = await readAssistantReviewBody(event, prepareAssistantPdfSchema)
  return prepareImportPdf(useDb(), actor, id, command)
})
