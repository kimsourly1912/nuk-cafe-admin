import * as v from 'valibot'

/** Private source foundation (D152); extraction/review/menu-write contracts come later. */
export const ASSISTANT_IMPORT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export type AssistantImportType = typeof ASSISTANT_IMPORT_TYPES[number]
/** Align with the existing server upload limit; the earlier 10 MB proposal is not adopted. */
export const ASSISTANT_IMPORT_MAX_BYTES = 5 * 1024 * 1024
export const ASSISTANT_IMPORT_RETENTION_MS = 24 * 60 * 60 * 1000
export const ASSISTANT_IMPORT_MAX_SOURCES = 5

/** No object key or public media URL is returned. Read bytes through the protected source route. */
export interface AssistantImportSource {
  id: string
  fileName: string
  mimeType: AssistantImportType
  byteSize: number
  version: number
  createdAt: string
  expiresAt: string
}

export const discardAssistantImportSchema = v.strictObject({
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
})
export type DiscardAssistantImportInput = v.InferOutput<typeof discardAssistantImportSchema>

/** Access is revoked immediately; failed byte deletion remains queued for the cleanup task. */
export interface DiscardAssistantImportResult {
  cleanupPending: boolean
}
