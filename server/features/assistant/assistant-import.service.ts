import type { Actor } from '#server/features/identity'
import { auditStatement } from '#server/features/platform'
import { checkImage } from '#server/features/media'
import type { Db } from '#server/utils/batch'
import { requireAtMost, requireOneChange, runBatch } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { versionConflict } from '#server/utils/errors'
import type { AssistantImportSource, AssistantImportType, DiscardAssistantImportResult } from '#shared/contracts/assistant-import'
import { ASSISTANT_IMPORT_MAX_BYTES, ASSISTANT_IMPORT_MAX_SOURCES, ASSISTANT_IMPORT_RETENTION_MS } from '#shared/contracts/assistant-import'
import { importInvalid, importNotFound, importSourceLimit, importStorageUnavailable, importTooLarge, importUnsupported } from './assistant-import.errors'
import * as repo from './assistant-import.repository'

/** NuxtHub FS locally / private R2 in Workers. Bucket public access must be disabled (operations). */
export interface ImportObjectStore {
  driver: { name: string }
  put: (key: string, bytes: Uint8Array<ArrayBuffer>, options: { contentType: string }) => Promise<unknown>
  get: (key: string) => Promise<Blob | null>
  del: (key: string) => Promise<unknown>
}

const extensions: Record<AssistantImportType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
const toSource = (row: repo.ImportRow): AssistantImportSource => ({
  id: row.id, fileName: row.fileName, mimeType: row.mimeType, byteSize: row.byteSize,
  version: row.version, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
})

export function assertPrivateImportStorage(store: ImportObjectStore) {
  if (!['fs', 'cloudflare-r2'].includes(store.driver.name)) throw importStorageUnavailable()
}

/** Signature/type validation is storage admission, not a claim that a PDF/image fully decodes. */
function checkSource(file: { type: string, fileName: string, data: Uint8Array<ArrayBuffer> }): AssistantImportType {
  if (!file.data.length) throw importInvalid('Choose a file to upload.')
  if (file.data.length > ASSISTANT_IMPORT_MAX_BYTES) throw importTooLarge()
  if (!file.fileName.trim() || file.fileName.length > 160 || /[\p{Cc}/\\]/u.test(file.fileName)) throw importInvalid('The file name is invalid.')
  if (file.type === 'application/pdf') {
    const header = new TextDecoder().decode(file.data.subarray(0, 9))
    if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n ]/.test(header)) throw importUnsupported()
    return 'application/pdf'
  }
  return checkImage(file)
}

/** Reserve DB/cleanup metadata before writing bytes, with an atomic per-owner/cafe source cap. */
export async function uploadImportSource(db: Db, store: ImportObjectStore, actor: Actor, file: { type: string, fileName: string, data: Uint8Array<ArrayBuffer> }): Promise<AssistantImportSource> {
  assertPrivateImportStorage(store)
  const mimeType = checkSource(file)
  const id = newId()
  const now = new Date()
  const objectKey = `t/${actor.tenantId}/assistant-import/${id}.${extensions[mimeType]}`
  const source = { id, tenantId: actor.tenantId, userId: actor.userId, objectKey, fileName: file.fileName, mimeType, byteSize: file.data.length, createdAt: now, expiresAt: new Date(now.getTime() + ASSISTANT_IMPORT_RETENTION_MS) }
  await runBatch(db, [
    ...repo.reserveStatements(db, source),
    requireAtMost(db, repo.activeSourceCount(db, actor, now), ASSISTANT_IMPORT_MAX_SOURCES),
    auditStatement(db, actor, { action: 'assistant.import.upload.requested', targetType: 'assistant_import', targetId: id, metadata: { mimeType, byteSize: file.data.length } }),
  ], importSourceLimit)
  try {
    await store.put(objectKey, file.data, { contentType: mimeType })
    const row = await repo.finishUpload(db, actor, id, new Date())
    if (!row) throw importNotFound()
    return toSource(row)
  }
  catch (error) {
    // Keep the ledger even if compensation fails; expiry/orphan cleanup can retry.
    try {
      await repo.abandonUpload(db, actor, id, objectKey)
      await deleteObject(db, store, objectKey)
    }
    catch { await store.del(objectKey).catch(() => {}) }
    throw error
  }
}

export async function listImportSources(db: Db, actor: Actor): Promise<AssistantImportSource[]> {
  return (await repo.listSources(db, actor, new Date())).map(toSource)
}

export async function getImportSource(db: Db, actor: Actor, id: string): Promise<AssistantImportSource> {
  const row = await repo.findSource(db, actor, id, new Date())
  if (!row) throw importNotFound()
  return toSource(row)
}

export async function readImportSource(db: Db, store: ImportObjectStore, actor: Actor, id: string) {
  assertPrivateImportStorage(store)
  const row = await repo.findSource(db, actor, id, new Date())
  if (!row) throw importNotFound()
  const data = await store.get(row.objectKey)
  // Recheck access after storage I/O: a concurrent discard/expiry must not return source bytes.
  if (!data || !await repo.findSource(db, actor, id, new Date())) throw importNotFound()
  return { data, mimeType: row.mimeType }
}

async function deleteObject(db: Db, store: ImportObjectStore, objectKey: string) {
  await store.del(objectKey)
  await repo.completeDelete(db, objectKey)
}

export async function discardImportSource(db: Db, store: ImportObjectStore, actor: Actor, id: string, version: number): Promise<DiscardAssistantImportResult> {
  assertPrivateImportStorage(store)
  const row = await repo.findSource(db, actor, id, new Date())
  if (!row) throw importNotFound()
  await runBatch(db, [
    repo.discardStatement(db, actor, id, version, new Date()), requireOneChange(db),
    repo.queueDeleteStatement(db, row.objectKey),
    auditStatement(db, actor, { action: 'assistant.import.discard', targetType: 'assistant_import', targetId: id }),
  ], () => versionConflict('This import source'))
  try {
    await deleteObject(db, store, row.objectKey)
    return { cleanupPending: false }
  }
  catch {
    return { cleanupPending: true }
  }
}

/** Operational cleanup across cafes, independent of the feature flag and surviving FK cascades. */
export async function purgeImportSources(db: Db, store: ImportObjectStore, options: { now?: Date, limit?: number } = {}) {
  assertPrivateImportStorage(store)
  const now = options.now ?? new Date()
  // At most 31 SQL statements + 10 R2 deletes: stay within Workers/D1 Free's 50-query budget.
  const limit = Math.min(10, Math.max(1, options.limit ?? 10))
  let deleted = 0
  let pending = 0
  for (const { objectKey } of await repo.dueObjects(db, now, limit)) {
    try {
      await repo.hideSource(db, objectKey)
      await deleteObject(db, store, objectKey)
      deleted++
    }
    catch { pending++ }
  }
  return { deleted, pending }
}
