import { Encrypter } from 'age-encryption'

/**
 * The nightly backup (D225): production's D1 database exported as SQL, encrypted with age for the
 * owner's public key (this Worker can't read a backup), and stored in an R2 bucket reached through
 * its S3 address: in the production account for now, a separate account later (the owner's choice,
 * D225 follow-up), with only the endpoint and key changing. That bucket's lock rules keep each copy
 * for its full period: no key, not even this Worker's own, can delete or overwrite one early. Each step's work lives here with `fetch`
 * passed in; `index.ts` runs them as Workflow steps.
 */

export interface BackupEnv {
  /** Production's account and its D1 database. */
  D1_ACCOUNT_ID?: string
  D1_DATABASE_ID: string
  /** A production API token that may export D1 (D1 Read, or D1 Edit if the export refuses Read). */
  D1_EXPORT_TOKEN?: string
  /** The backup bucket's R2 S3 endpoint, `https://<account id>.r2.cloudflarestorage.com`. */
  BACKUP_R2_ENDPOINT?: string
  BACKUP_R2_BUCKET: string
  /** The backup bucket's R2 API token (Object Read & Write on that bucket only). */
  BACKUP_R2_ACCESS_KEY_ID?: string
  BACKUP_R2_SECRET_ACCESS_KEY?: string
  /** The owner's age public keys (`age1…`), separated by spaces or commas. */
  BACKUP_AGE_RECIPIENTS?: string
  /** The Angder Ops chat (D223), for failures and the weekly "still running". */
  OPS_TELEGRAM_BOT_TOKEN?: string
  OPS_TELEGRAM_CHAT_ID?: string
  /** Cloudflare's and Telegram's APIs; only the local end-to-end check points them elsewhere. */
  CLOUDFLARE_API_URL?: string
  TELEGRAM_API_URL?: string
}

/** What a run needs; `index.ts` refuses to start without all of them. */
const REQUIRED = [
  'D1_ACCOUNT_ID',
  'D1_EXPORT_TOKEN',
  'BACKUP_R2_ENDPOINT',
  'BACKUP_R2_ACCESS_KEY_ID',
  'BACKUP_R2_SECRET_ACCESS_KEY',
  'BACKUP_AGE_RECIPIENTS',
  'OPS_TELEGRAM_BOT_TOKEN',
  'OPS_TELEGRAM_CHAT_ID',
] as const satisfies readonly (keyof BackupEnv)[]

/** The names of the settings that are missing (never their values). */
export function missingSettings(env: BackupEnv): string[] {
  return REQUIRED.filter(name => !env[name]?.trim())
}

/**
 * The largest dump this Worker backs up. The dump and its encrypted copy are held in memory (R2's
 * upload needs the length first), well inside a Worker's 128 MB. A bigger database fails the run
 * loudly; then switch to a streamed upload (D225).
 */
export const MAX_DUMP_BYTES = 40 * 1024 * 1024
/** How long one call to Cloudflare, the dump download or Telegram may take. */
const TIMEOUT_MS = 60_000
/** Error bodies are quoted this far in a failure, never more. */
const ERROR_TEXT_LENGTH = 300

/**
 * A failure no retry can fix (D227): a token without permission, a wrong key, an account, bucket or
 * address that doesn't exist, a public key that isn't one, a database too big for memory. `index.ts`
 * ends the step at once with it, so the ops chat hears the reason within a minute instead of after
 * hours of retries. Anything else (a busy service, the network, an export not ready yet) retries.
 */
export class PermanentError extends Error {
  override name = 'PermanentError'
}

/** Answers that say the request itself is wrong (its token, key, account, bucket or address), not that the service is busy. */
const PERMANENT_STATUSES = new Set([400, 401, 403, 404])

/** A refused request's error: permanent for those statuses, otherwise one to retry. */
function refusal(status: number, message: string): Error {
  return PERMANENT_STATUSES.has(status) ? new PermanentError(message) : new Error(message)
}

/** Cambodia's clock (UTC+7, no daylight saving): the date and its parts. */
export function cambodiaDate(ms: number) {
  const local = new Date(ms + 7 * 3_600_000)
  return {
    date: local.toISOString().slice(0, 10),
    month: local.toISOString().slice(0, 7),
    day: local.getUTCDate(),
    weekday: local.getUTCDay() === 0 ? 7 : local.getUTCDay(),
    label: `${local.toISOString().slice(0, 16).replace('T', ' ')} Cambodia time`,
  }
}

/**
 * Where a run's copy goes: `daily/` every night, and `monthly/` too on the 1st (Cambodia's date),
 * so the bucket's rules can keep 30 nights and 12 months apart. From the run's own start time, so a
 * retry after midnight still writes the night it belongs to.
 */
export function backupKeys(startedAt: number): string[] {
  const { date, month, day } = cambodiaDate(startedAt)
  const keys = [`daily/angder-${date}.sql.age`]
  if (day === 1) keys.push(`monthly/angder-${month}.sql.age`)
  return keys
}

interface ExportResult {
  success?: boolean
  errors?: { message?: string }[]
  result?: { at_bookmark?: string, status?: string, signed_url?: string, error?: string }
}

/** One call to D1's export endpoint; throws on anything but a successful answer. */
async function callExport(fetchFn: typeof fetch, env: BackupEnv, body: Record<string, unknown>): Promise<NonNullable<ExportResult['result']>> {
  const api = env.CLOUDFLARE_API_URL ?? 'https://api.cloudflare.com/client/v4'
  const response = await fetchFn(`${api}/accounts/${env.D1_ACCOUNT_ID}/d1/database/${env.D1_DATABASE_ID}/export`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${env.D1_EXPORT_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await response.text()
  let answer: ExportResult | undefined
  try {
    answer = JSON.parse(text) as ExportResult
  }
  catch {
    answer = undefined
  }
  if (!response.ok || !answer?.success || !answer.result) {
    const reason = answer?.errors?.map(error => error.message).filter(Boolean).join('; ') || text.slice(0, ERROR_TEXT_LENGTH)
    throw refusal(response.status, `D1's export answered HTTP ${response.status}: ${reason}`)
  }
  if (answer.result.error) throw new Error(`D1's export failed: ${answer.result.error.slice(0, ERROR_TEXT_LENGTH)}`)
  return answer.result
}

/** Starts an export of the whole database; answers the bookmark it's taken at. */
export async function startExport(fetchFn: typeof fetch, env: BackupEnv): Promise<string> {
  const result = await callExport(fetchFn, env, { output_format: 'polling' })
  if (!result.at_bookmark) throw new Error('D1\'s export gave no bookmark')
  return result.at_bookmark
}

/** The export's download address once it's ready, `null` while D1 is still writing it. */
export async function exportedDump(fetchFn: typeof fetch, env: BackupEnv, bookmark: string): Promise<string | null> {
  const result = await callExport(fetchFn, env, { output_format: 'polling', current_bookmark: bookmark })
  return result.signed_url ?? null
}

/** Reads a stream to its end, refusing more than `max` bytes. */
async function readAtMost(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      throw tooBig()
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

const tooBig = () => new PermanentError(`The database dump is larger than ${MAX_DUMP_BYTES / 1024 / 1024} MB, the most this backup holds in memory: switch it to a streamed upload (D225).`)

/** The SQL dump from its download address. An empty dump is an error: production always has tables. */
export async function downloadDump(fetchFn: typeof fetch, url: string): Promise<Uint8Array> {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error(`The dump download answered HTTP ${response.status}`)
  }
  if (Number(response.headers.get('content-length')) > MAX_DUMP_BYTES) {
    await response.body.cancel()
    throw tooBig()
  }
  const dump = await readAtMost(response.body, MAX_DUMP_BYTES)
  if (dump.byteLength === 0) throw new Error('The database dump is empty')
  return dump
}

/** The dump encrypted with age for every listed public key; only their private keys can read it. */
export async function encryptDump(dump: Uint8Array, recipients: string): Promise<Uint8Array<ArrayBuffer>> {
  const keys = recipients.split(/[\s,]+/).filter(Boolean)
  if (keys.length === 0) throw new PermanentError('BACKUP_AGE_RECIPIENTS has no public key')
  const encrypter = new Encrypter()
  for (const key of keys) {
    try {
      encrypter.addRecipient(key)
    }
    catch (error) {
      throw new PermanentError(`BACKUP_AGE_RECIPIENTS holds something that isn't an age public key (age1…): ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const encrypted = await encrypter.encrypt(dump)
  // A request body must sit on a plain ArrayBuffer; age's output does, so this is a view, not a copy.
  return encrypted.buffer instanceof ArrayBuffer ? new Uint8Array(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength) : encrypted.slice()
}

/** A request signed for the backup bucket's R2 (aws4fetch's `AwsClient.fetch` in the Worker). */
export type SignedFetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * Stores one copy, never replacing one: `If-None-Match: *` refuses an existing key, and the
 * bucket's lock refuses to overwrite a kept one (HTTP 409). Either way that night's copy is
 * already there, so a retried or repeated run answers `exists` instead of failing.
 */
export async function storeCopy(signedFetch: SignedFetch, env: BackupEnv, key: string, body: Uint8Array<ArrayBuffer>): Promise<'stored' | 'exists'> {
  const url = `${env.BACKUP_R2_ENDPOINT!.replace(/\/+$/, '')}/${env.BACKUP_R2_BUCKET}/${key}`
  const response = await signedFetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await response.text()
  if (response.ok) return 'stored'
  if (response.status === 412 || (response.status === 409 && text.includes('ObjectLockedByBucketPolicy'))) return 'exists'
  throw refusal(response.status, `The backup bucket refused ${key}: HTTP ${response.status} ${text.slice(0, ERROR_TEXT_LENGTH)}`)
}

/** A short size: `12.3 KB`, `4.5 MB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export interface StoredBackup {
  keys: string[]
  /** The encrypted copy's size. */
  bytes: number
  /** Whether each key was written now or was already there. */
  results: ('stored' | 'exists')[]
}

const RUNBOOK = 'What to do: docs/server/operations.md → Backups and restore.'

export function failureText(error: unknown, at: number): string {
  // A permanent failure reaches here as the Workflow's NonRetryableError (D227): its prefix says nothing to the owner.
  const reason = (error instanceof Error ? error.message : String(error)).replace(/^NonRetryableError:\s*/, '')
  return [
    '🔴 Angder backup FAILED',
    `Tonight's copy of the production database wasn't stored (${cambodiaDate(at).label}).`,
    `Reason: ${reason.slice(0, ERROR_TEXT_LENGTH)}`,
    'Earlier copies are untouched. The next run is tomorrow night; to try again now, run the Deploy backup workflow.',
    RUNBOOK,
  ].join('\n')
}

export function successText(backup: StoredBackup, weekly: boolean): string {
  return [
    weekly ? '🟢 Angder backups are running' : '🟢 Angder backup stored',
    ...backup.keys.map((key, i) => `${key}: ${backup.results[i] === 'stored' ? 'stored' : 'already there'} (${formatSize(backup.bytes)})`),
    weekly ? 'This message comes every Monday; a missing one means the backup has stopped.' : 'Encrypted for the owner\'s key, kept in the backup bucket.',
  ].join('\n')
}

/** Sends one message to the ops chat; throws when Telegram doesn't take it (the Workflow retries). */
export async function sendOps(fetchFn: typeof fetch, env: BackupEnv, text: string): Promise<void> {
  const api = env.TELEGRAM_API_URL ?? 'https://api.telegram.org'
  const response = await fetchFn(`${api}/bot${env.OPS_TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.OPS_TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    // Telegram's own reason only: the URL holds the bot token and is never logged.
    const reason = ((await response.json().catch(() => ({}))) as { description?: string }).description ?? ''
    throw new Error(`Telegram refused the message: HTTP ${response.status} ${reason.slice(0, ERROR_TEXT_LENGTH)}`)
  }
  await response.body?.cancel()
}
