import { listImportSources } from '#server/features/assistant'

export default defineEventHandler(async (event) => {
  const actor = await requireAssistantImport(event)
  return listImportSources(useDb(), actor)
})
