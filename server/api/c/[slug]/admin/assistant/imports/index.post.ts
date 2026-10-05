import { assertPrivateImportStorage, uploadImportSource } from '#server/features/assistant'

/** Raw file bytes, Content-Type + URI-encoded X-File-Name; no question or client tenant/key. */
export default defineEventHandler(async (event) => {
  const actor = await requireAssistantImport(event)
  assertPrivateImportStorage(blob)
  const file = await readAssistantImportFile(event)
  const source = await uploadImportSource(useDb(), blob, actor, file)
  setResponseStatus(event, 201)
  return source
})
