import { updateAssistantImportRowSchema } from '#shared/contracts/assistant-import'
import { updateImportReviewRow } from '#server/features/assistant'

export default defineEventHandler(async (event) => {
  const actor = await requireAssistantImport(event)
  const id = readIdParam(event, 'id', 'This import source')
  const rowId = readIdParam(event, 'rowId', 'This review row')
  const input = await readAssistantReviewBody(event, updateAssistantImportRowSchema)
  return updateImportReviewRow(useDb(), actor, id, rowId, input)
})
