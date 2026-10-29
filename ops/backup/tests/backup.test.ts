import { Decrypter, generateIdentity, identityToRecipient } from 'age-encryption'
import { describe, expect, it, vi } from 'vitest'
import { backupKeys, downloadDump, encryptDump, exportedDump, failureText, MAX_DUMP_BYTES, missingSettings, sendOps, startExport, storeCopy, successText } from '../src/backup'
import type { BackupEnv } from '../src/backup'

// The nightly backup's steps (D225) with stand-ins for Cloudflare's API, the backup bucket and Telegram.

const env: BackupEnv = {
  D1_ACCOUNT_ID: 'prod-account',
  D1_DATABASE_ID: 'prod-db',
  D1_EXPORT_TOKEN: 'd1-secret-token',
  BACKUP_R2_ENDPOINT: 'https://backup-account.r2.cloudflarestorage.com/',
  BACKUP_R2_BUCKET: 'angder-backups',
  BACKUP_R2_ACCESS_KEY_ID: 'key-id',
  BACKUP_R2_SECRET_ACCESS_KEY: 'r2-secret',
  BACKUP_AGE_RECIPIENTS: 'age1unused',
  OPS_TELEGRAM_BOT_TOKEN: '123:bot-secret',
  OPS_TELEGRAM_CHAT_ID: '-100',
}
const SECRETS = ['d1-secret-token', 'r2-secret', '123:bot-secret']

/** A fetch that answers `respond` and records each call. */
function stub(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string, init?: RequestInit }[] = []
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return respond(String(input), init)
  }) as unknown as typeof fetch
  return { fetchFn, calls }
}

const exportAnswer = (result: Record<string, unknown>) => Response.json({ success: true, errors: [], result })
const bytes = (text: string) => new TextEncoder().encode(text)

describe('where a night\'s copy goes', () => {
  it('writes daily/ every night, by Cambodia\'s date', () => {
    // 2026-10-29 20:17 UTC is 2026-10-30 03:17 in Cambodia.
    expect(backupKeys(Date.parse('2026-10-29T20:17:00Z'))).toEqual(['daily/angder-2026-10-30.sql.age'])
  })

  it('also writes monthly/ on Cambodia\'s 1st, while UTC is still the month before', () => {
    expect(backupKeys(Date.parse('2026-10-31T20:17:00Z'))).toEqual(['daily/angder-2026-11-01.sql.age', 'monthly/angder-2026-11.sql.age'])
  })
})

describe('settings', () => {
  it('names what is missing, never a value', () => {
    expect(missingSettings(env)).toEqual([])
    const missing = missingSettings({ ...env, D1_EXPORT_TOKEN: ' ', BACKUP_AGE_RECIPIENTS: undefined })
    expect(missing).toEqual(['D1_EXPORT_TOKEN', 'BACKUP_AGE_RECIPIENTS'])
  })
})

describe('the export', () => {
  it('starts one for production\'s database with the token, and answers its bookmark', async () => {
    const { fetchFn, calls } = stub(() => exportAnswer({ at_bookmark: 'bm-1', status: 'active' }))
    expect(await startExport(fetchFn, env)).toBe('bm-1')
    expect(calls[0]!.url).toBe('https://api.cloudflare.com/client/v4/accounts/prod-account/d1/database/prod-db/export')
    expect(new Headers(calls[0]!.init!.headers).get('authorization')).toBe('Bearer d1-secret-token')
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ output_format: 'polling' })
  })

  it('fails with Cloudflare\'s reason, not the token, when refused', async () => {
    const { fetchFn } = stub(() => Response.json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, { status: 403 }))
    const error = await startExport(fetchFn, env).catch((e: Error) => e)
    expect(String(error)).toContain('HTTP 403: Authentication error')
    for (const secret of SECRETS) expect(String(error)).not.toContain(secret)
  })

  it('fails on an answer that isn\'t Cloudflare\'s JSON', async () => {
    const { fetchFn } = stub(() => new Response('<html>Bad gateway</html>', { status: 502 }))
    await expect(startExport(fetchFn, env)).rejects.toThrow('HTTP 502: <html>Bad gateway</html>')
  })

  it('answers null while D1 is still writing it, then its download address', async () => {
    const pending = stub(() => exportAnswer({ at_bookmark: 'bm-1', status: 'active' }))
    expect(await exportedDump(pending.fetchFn, env, 'bm-1')).toBeNull()
    expect(JSON.parse(String(pending.calls[0]!.init!.body))).toEqual({ output_format: 'polling', current_bookmark: 'bm-1' })
    const ready = stub(() => exportAnswer({ status: 'complete', signed_url: 'https://dump.example/x.sql' }))
    expect(await exportedDump(ready.fetchFn, env, 'bm-1')).toBe('https://dump.example/x.sql')
  })

  it('fails when D1 reports the export failed', async () => {
    const { fetchFn } = stub(() => exportAnswer({ status: 'error', error: 'Database too busy' }))
    await expect(exportedDump(fetchFn, env, 'bm-1')).rejects.toThrow('D1\'s export failed: Database too busy')
  })
})

describe('the dump', () => {
  it('downloads it whole', async () => {
    const { fetchFn } = stub(() => new Response('CREATE TABLE t (id);\nINSERT INTO t VALUES (1);'))
    expect(new TextDecoder().decode(await downloadDump(fetchFn, 'https://dump.example/x.sql'))).toBe('CREATE TABLE t (id);\nINSERT INTO t VALUES (1);')
  })

  it('refuses one larger than it holds in memory, by its stated length or as it streams', async () => {
    const stated = stub(() => new Response('x', { headers: { 'content-length': String(MAX_DUMP_BYTES + 1) } }))
    await expect(downloadDump(stated.fetchFn, 'u')).rejects.toThrow('switch it to a streamed upload')
    // No stated length, and 2 MB more than the limit.
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const tooLong = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= MAX_DUMP_BYTES + 2 * chunk.byteLength) return controller.close()
        sent += chunk.byteLength
        controller.enqueue(chunk)
      },
    })
    const streamed = stub(() => new Response(tooLong))
    // Compared as text: a wrongly accepted 42 MB dump would be too big to print in the failure.
    const outcome = await downloadDump(streamed.fetchFn, 'u').then(dump => `accepted ${dump.byteLength} bytes`, (error: Error) => error.message)
    expect(outcome).toContain('switch it to a streamed upload')
    expect(sent).toBeLessThanOrEqual(MAX_DUMP_BYTES + 2 * chunk.byteLength)
  })

  it('fails on an empty dump or a failed download', async () => {
    await expect(downloadDump(stub(() => new Response('')).fetchFn, 'u')).rejects.toThrow('empty')
    await expect(downloadDump(stub(() => new Response('gone', { status: 404 })).fetchFn, 'u')).rejects.toThrow('HTTP 404')
  })
})

describe('encryption', () => {
  it('only the listed keys can read a copy, and every one of them can', async () => {
    const owner = await generateIdentity()
    const spare = await generateIdentity()
    const stranger = await generateIdentity()
    const dump = bytes('INSERT INTO orders VALUES (\'order-1\', 1250);')
    const encrypted = await encryptDump(dump, ` ${await identityToRecipient(owner)},\n${await identityToRecipient(spare)} `)
    expect(new TextDecoder().decode(encrypted)).not.toContain('order-1')
    for (const identity of [owner, spare]) {
      const decrypter = new Decrypter()
      decrypter.addIdentity(identity)
      expect(await decrypter.decrypt(encrypted, 'text')).toBe('INSERT INTO orders VALUES (\'order-1\', 1250);')
    }
    const wrong = new Decrypter()
    wrong.addIdentity(stranger)
    await expect(wrong.decrypt(encrypted)).rejects.toThrow()
  })

  it('refuses to run without a public key', async () => {
    await expect(encryptDump(bytes('x'), ' , ')).rejects.toThrow('no public key')
  })
})

describe('storing a copy', () => {
  const body = new Uint8Array([1, 2, 3])

  it('puts it in the backup bucket, never over an existing key', async () => {
    const { fetchFn, calls } = stub(() => new Response(null, { status: 200 }))
    expect(await storeCopy(fetchFn, env, 'daily/angder-2026-10-30.sql.age', body)).toBe('stored')
    expect(calls[0]!.url).toBe('https://backup-account.r2.cloudflarestorage.com/angder-backups/daily/angder-2026-10-30.sql.age')
    expect(calls[0]!.init!.method).toBe('PUT')
    expect(new Headers(calls[0]!.init!.headers).get('if-none-match')).toBe('*')
  })

  it('treats a copy already there as done: the key exists (412) or the lock keeps it (409)', async () => {
    expect(await storeCopy(stub(() => new Response('<Error><Code>PreconditionFailed</Code></Error>', { status: 412 })).fetchFn, env, 'k', body)).toBe('exists')
    expect(await storeCopy(stub(() => new Response('<Error><Code>ObjectLockedByBucketPolicy</Code></Error>', { status: 409 })).fetchFn, env, 'k', body)).toBe('exists')
  })

  it('fails on any other refusal', async () => {
    await expect(storeCopy(stub(() => new Response('<Error><Code>OperationAborted</Code></Error>', { status: 409 })).fetchFn, env, 'k', body)).rejects.toThrow('HTTP 409')
    await expect(storeCopy(stub(() => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })).fetchFn, env, 'k', body)).rejects.toThrow('AccessDenied')
  })
})

describe('the ops chat', () => {
  it('sends to the ops chat with its bot', async () => {
    const { fetchFn, calls } = stub(() => Response.json({ ok: true }))
    await sendOps(fetchFn, env, 'hello')
    expect(calls[0]!.url).toBe('https://api.telegram.org/bot123:bot-secret/sendMessage')
    expect(JSON.parse(String(calls[0]!.init!.body))).toMatchObject({ chat_id: '-100', text: 'hello' })
  })

  it('throws with Telegram\'s reason, without the token, when refused (the Workflow retries)', async () => {
    const { fetchFn } = stub(() => Response.json({ ok: false, description: 'Bad Request: chat not found' }, { status: 400 }))
    const error = await sendOps(fetchFn, env, 'hello').catch((e: Error) => e)
    expect(String(error)).toContain('HTTP 400 Bad Request: chat not found')
    for (const secret of SECRETS) expect(String(error)).not.toContain(secret)
  })

  it('says what failed and where to look, with no secret', () => {
    const text = failureText(new Error('D1\'s export answered HTTP 403: Authentication error'), Date.parse('2026-10-29T20:17:00Z'))
    expect(text).toContain('Angder backup FAILED')
    expect(text).toContain('2026-10-30 03:17 Cambodia time')
    expect(text).toContain('HTTP 403: Authentication error')
    expect(text).toContain('docs/server/operations.md → Backups and restore')
    for (const secret of SECRETS) expect(text).not.toContain(secret)
  })

  it('reports a stored copy, and on Mondays that backups are still running', () => {
    const backup = { keys: ['daily/angder-2026-11-02.sql.age', 'monthly/angder-2026-11.sql.age'], bytes: 12_800, results: ['stored', 'exists'] as const }
    const report = successText({ ...backup, results: [...backup.results] }, false)
    expect(report).toContain('Angder backup stored')
    expect(report).toContain('daily/angder-2026-11-02.sql.age: stored (12.5 KB)')
    expect(report).toContain('monthly/angder-2026-11.sql.age: already there')
    expect(successText({ ...backup, results: [...backup.results] }, true)).toContain('a missing one means the backup has stopped')
  })
})
