import { apiError } from '#server/utils/errors'
import { extractImportPdfPage } from '#server/features/assistant'

export default defineEventHandler(async (event) => {
  const actor = await requireAssistantImport(event)
  const id = readIdParam(event, 'id', 'This import source')
  const rawPage = getRouterParam(event, 'pageNumber') ?? ''
  if (!/^[1-5]$/.test(rawPage)) throw apiError(400, 'VALIDATION_FAILED', 'Choose a page number from one to five.')
  const { version, bytes } = await readAssistantPdfPage(event)
  return extractImportPdfPage(useDb(), blob, actor, id, Number(rawPage), version, bytes, () => assistantImportModel(event), event.web?.request?.signal)
})
