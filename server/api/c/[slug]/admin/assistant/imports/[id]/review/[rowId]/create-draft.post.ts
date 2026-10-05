import { createAssistantImportDraftSchema } from '#shared/contracts/assistant-import'
import { createImportDraft } from '#server/features/assistant'

/** Explicitly create one reviewed draft; the UI batches selected rows with partial results. */
export default defineEventHandler(async (event) => {
  const actor = await requireAssistantImport(event, { menuWrite: true })
  const id = readIdParam(event, 'id', 'This import source')
  const rowId = readIdParam(event, 'rowId', 'This review row')
  const input = await readAssistantReviewBody(event, createAssistantImportDraftSchema)
  return createImportDraft(useDb(), actor, id, rowId, input, readIdempotencyKey(event))
})
