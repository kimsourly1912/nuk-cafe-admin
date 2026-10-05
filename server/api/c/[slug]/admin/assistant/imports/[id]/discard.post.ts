import { discardAssistantImportSchema } from '#shared/contracts/assistant-import'
import { discardImportSource } from '#server/features/assistant'

export default defineEventHandler(async (event) => {
  const actor = await requireAssistantImport(event)
  const id = readIdParam(event, 'id', 'This import source')
  const { version } = await readValidBody(event, discardAssistantImportSchema)
  return discardImportSource(useDb(), blob, actor, id, version)
})
