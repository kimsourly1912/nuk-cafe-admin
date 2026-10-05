import { readImportSource } from '#server/features/assistant'

/** Authenticated bytes only; fetch PDF data for a future browser parser, never embed active PDF. */
export default defineEventHandler(async (event) => {
  const actor = await requireAssistantImport(event)
  const { data, mimeType } = await readImportSource(useDb(), blob, actor, readIdParam(event, 'id', 'This import source'))
  setHeaders(event, {
    'Content-Type': mimeType,
    'Content-Length': String(data.size),
    'Content-Disposition': 'attachment; filename="menu-source"',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'default-src \'none\'; sandbox',
  })
  return data.stream()
})
