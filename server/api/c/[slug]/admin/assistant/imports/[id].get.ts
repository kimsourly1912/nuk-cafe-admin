import { getImportSource } from '#server/features/assistant'

export default defineEventHandler(async (event) => {
  const actor = await requireAssistantImport(event)
  return getImportSource(useDb(), actor, readIdParam(event, 'id', 'This import source'))
})
