import * as v from 'valibot'
import { idSchema, versionSchema } from './common'
import { createItemSchema, itemVariationSchema } from './menu-items'

/** Private sources, image reviews and explicit reviewed draft creation (D152–D154). */
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

export const ASSISTANT_IMPORT_MAX_ITEMS = 50
export const ASSISTANT_IMPORT_REVIEW_MAX_BYTES = 64 * 1024
export const ASSISTANT_IMPORT_MAX_IMAGE_SIDE = 8192
export const ASSISTANT_IMPORT_MAX_IMAGE_PIXELS = 16_000_000
export const ASSISTANT_IMPORT_REVIEW_STATES = ['none', 'processing', 'ready', 'failed'] as const
export const ASSISTANT_IMPORT_FLAGS = ['missing-price', 'ambiguous-currency', 'ambiguous-association', 'unreadable'] as const
export const ASSISTANT_IMPORT_FAILURES = ['AI_LIMIT_REACHED', 'AI_CAPACITY_REACHED', 'AI_IMPORT_CANCELLED', 'AI_IMPORT_RESULT_INVALID', 'AI_IMPORT_EXTRACTION_FAILED', 'AI_IMPORT_INTERRUPTED'] as const
export type AssistantImportFailure = typeof ASSISTANT_IMPORT_FAILURES[number]

const boundedText = (max: number) => v.pipe(v.string(), v.maxLength(max))
const priceSchema = v.strictObject({
  label: v.nullable(boundedText(80)),
  amount: v.nullable(v.pipe(v.string(), v.regex(/^\d{1,8}(?:\.\d{1,4})?$/))),
  currency: v.picklist(['USD', 'KHR', 'unknown']),
  evidence: v.nullable(boundedText(160)),
})
export const extractedMenuItemSchema = v.strictObject({
  name: v.pipe(boundedText(80), v.minLength(1), v.regex(/\S/)),
  description: v.nullable(boundedText(500)),
  category: v.nullable(boundedText(80)),
  prices: v.pipe(v.array(priceSchema), v.minLength(1), v.maxLength(20)),
  flags: v.pipe(v.array(v.picklist(ASSISTANT_IMPORT_FLAGS)), v.maxLength(4)),
})
/** Provider output is evidence, never a menu command or tenant/library id. */
export const extractedMenuSchema = v.strictObject({
  items: v.pipe(v.array(extractedMenuItemSchema), v.minLength(1), v.maxLength(ASSISTANT_IMPORT_MAX_ITEMS)),
})
export type ExtractedMenu = v.InferOutput<typeof extractedMenuSchema>
export type ExtractedMenuItem = v.InferOutput<typeof extractedMenuItemSchema>

/** Incomplete corrections can be saved; Create drafts will require full menu validation. */
export const assistantImportDraftSchema = v.strictObject({
  name: boundedText(80),
  description: boundedText(500),
  categoryId: v.nullable(idSchema),
  optionSetIds: createItemSchema.entries.optionSetIds,
  variations: v.pipe(v.array(itemVariationSchema), v.maxLength(400)),
  modifierGroups: createItemSchema.entries.modifierGroups,
  availabilityRuleIds: createItemSchema.entries.availabilityRuleIds,
})
export type AssistantImportDraft = v.InferOutput<typeof assistantImportDraftSchema>
export interface AssistantImportReviewRow {
  id: string
  source: ExtractedMenuItem
  selected: boolean
  draft: AssistantImportDraft
  /** Receipt after explicit creation; absent on unsaved/older reviews. Never create this row again. */
  createdItemId?: string
}
export interface AssistantImportReview {
  source: AssistantImportSource
  state: typeof ASSISTANT_IMPORT_REVIEW_STATES[number]
  error: AssistantImportFailure | null
  /** An active processing/cancelled lease blocks retry until this time or the worker exits. */
  retryAt: string | null
  rows: AssistantImportReviewRow[]
}
export const extractAssistantImportSchema = v.strictObject({ version: versionSchema })
export type ExtractAssistantImportInput = v.InferOutput<typeof extractAssistantImportSchema>
export const updateAssistantImportRowSchema = v.pipe(v.strictObject({
  version: versionSchema,
  selected: v.optional(v.boolean()),
  draft: v.optional(assistantImportDraftSchema),
}), v.check(input => input.selected !== undefined || input.draft !== undefined, 'Send a correction or selection.'))
export type UpdateAssistantImportRowInput = v.InferOutput<typeof updateAssistantImportRowSchema>

/** One selected row per action; save corrections first. No item data or publishing command. */
export const createAssistantImportDraftSchema = v.strictObject({
  version: versionSchema,
  confirmDuplicate: v.optional(v.boolean(), false),
})
export type CreateAssistantImportDraftInput = v.InferOutput<typeof createAssistantImportDraftSchema>
export interface CreateAssistantImportDraftResult {
  sourceId: string
  rowId: string
  itemId: string
  /** Snapshot version: resume the review after a replay before the next edit/save. */
  version: number
  alreadyCreated: boolean
  replayed: boolean
}
