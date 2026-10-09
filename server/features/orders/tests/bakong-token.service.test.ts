import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Actor } from '#server/features/identity'
import { auditEvents } from '#server/features/platform/platform.schema'
import { BakongKeyError, BakongSealError, importBakongKey, openBakongToken, sealBakongToken } from '#server/features/orders/bakong-token'
import { bakongTokenExpiries, hasBakongToken, removeBakongToken, saveBakongToken, tenantBakongClient } from '#server/features/orders/bakong-token.service'
import type { BakongSetup } from '#server/features/orders/bakong-token.service'
import { getKhqrSettings } from '#server/features/orders/khqr.service'
import { bakongTokens } from '#server/features/orders/orders.schema'
import { createAdmin, createTestDb, ensureTenant, TEST_TENANT } from '#server/tests/support/db'
import { expectApiError } from '#server/tests/support/failure'
import { interleaved } from '#server/tests/support/interleave'
import type { Db } from '#server/utils/batch'

// Each cafe's own Bakong token (step T2d, D148): sealed with the server's key, the cafe's id bound
// in, never answered again; replaced and removed at the version read; one cafe's never another's.

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)))
const OTHER_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 200 - i)))
const NOW = new Date('2026-10-09T05:00:00.000Z')

/** A token shaped like Bakong's (a JWT) that stops working at `exp`. */
function token(exp: Date | null, name = 'nuk') {
  const part = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ data: { id: name }, ...(exp && { exp: Math.floor(exp.getTime() / 1000) }) })}.c2lnbmF0dXJl`
}
const IN_90_DAYS = new Date(NOW.getTime() + 90 * 86_400_000)

let db: Db
let owner: Actor
let otherOwner: Actor
/** What Bakong was asked, by which token. */
let asked: string[]
let setup: BakongSetup

beforeEach(async () => {
  db = await createTestDb()
  owner = { userId: (await createAdmin(db, 'owner@nuk.example')).userId, tenantId: TEST_TENANT, role: 'owner' }
  await ensureTenant(db, 'tenant-2', 'brown-bean')
  otherOwner = { userId: (await createAdmin(db, 'owner@brown.example', 'tenant-2')).userId, tenantId: 'tenant-2', role: 'owner' }
  asked = []
  const fetchStub: typeof fetch = async (_url, init) => {
    asked.push(new Headers(init?.headers).get('Authorization') ?? '')
    return Response.json({ responseCode: 1, errorCode: 1, responseMessage: 'Transaction could not be found', data: null })
  }
  setup = { apiUrl: 'https://bakong.example', encryptionKey: KEY, fetch: fetchStub }
})

describe('sealing', () => {
  it('opens only with the same key for the same cafe; every seal differs', async () => {
    const key = await importBakongKey(KEY)
    const sealed = await sealBakongToken(key, TEST_TENANT, 'secret-token')
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+$/)
    expect(sealed).not.toContain('secret-token')
    expect(await sealBakongToken(key, TEST_TENANT, 'secret-token')).not.toBe(sealed)
    expect(await openBakongToken(key, TEST_TENANT, sealed)).toBe('secret-token')

    await expect(openBakongToken(key, 'tenant-2', sealed)).rejects.toThrow(BakongSealError)
    await expect(openBakongToken(await importBakongKey(OTHER_KEY), TEST_TENANT, sealed)).rejects.toThrow(BakongSealError)
    const [scheme, iv, data] = sealed.split('.')
    const altered = `${scheme}.${iv}.${data!.slice(0, -2)}${data!.endsWith('A') ? 'B' : 'A'}${data!.slice(-1)}`
    await expect(openBakongToken(key, TEST_TENANT, altered)).rejects.toThrow(BakongSealError)
  })

  it('needs a key of 32 bytes', async () => {
    await expect(importBakongKey(btoa('too short'))).rejects.toThrow(BakongKeyError)
    await expect(importBakongKey('not base64 at all!')).rejects.toThrow(BakongKeyError)
  })
})

describe('saving a cafe\'s token', () => {
  it('stores it sealed, answers only its expiry and who set it, audits without it', async () => {
    const value = token(IN_90_DAYS)
    const settings = await saveBakongToken(db, owner, { version: 0, token: value }, setup, NOW)
    expect(settings).toMatchObject({
      automaticCheck: true,
      tokenStorage: true,
      token: { version: 1, expiresAt: IN_90_DAYS.toISOString().replace(/\.\d{3}Z$/, '.000Z'), setAt: NOW.toISOString(), setBy: { name: 'Admin' } },
    })
    expect(JSON.stringify(settings)).not.toContain(value)
    const [row] = await db.select().from(bakongTokens).where(eq(bakongTokens.tenantId, TEST_TENANT))
    expect(row!.sealed).not.toContain(value)
    const audits = await db.select({ action: auditEvents.action, metadata: auditEvents.metadata }).from(auditEvents)
      .where(and(eq(auditEvents.tenantId, TEST_TENANT), eq(auditEvents.targetType, 'bakong_token')))
    expect(audits.map(a => a.action)).toEqual(['orders.bakong_token.set'])
    expect(JSON.stringify(audits)).not.toContain(value)
  })

  it('replaces at the version read; a stale version, or a change meanwhile, is refused', async () => {
    await saveBakongToken(db, owner, { version: 0, token: token(IN_90_DAYS, 'first') }, setup, NOW)
    await expectApiError(() => saveBakongToken(db, owner, { version: 0, token: token(IN_90_DAYS, 'again') }, setup, NOW), 409, 'VERSION_CONFLICT')
    const replaced = await saveBakongToken(db, owner, { version: 1, token: token(IN_90_DAYS, 'second') }, setup, NOW)
    expect(replaced.token?.version).toBe(2)

    // Another tab replaces it between this save's check and its write: only the version guard sees it.
    const racing = interleaved(db, () => saveBakongToken(db, owner, { version: 2, token: token(IN_90_DAYS, 'theirs') }, setup, NOW))
    await expectApiError(() => saveBakongToken(racing, owner, { version: 2, token: token(IN_90_DAYS, 'mine') }, setup, NOW), 409, 'VERSION_CONFLICT')
    const client = await tenantBakongClient(db, TEST_TENANT, setup)
    await client!.checkByMd5('a'.repeat(32))
    expect(asked).toEqual([`Bearer ${token(IN_90_DAYS, 'theirs')}`])
  })

  it('two first saves at once: one wins, the other is refused', async () => {
    const racing = interleaved(db, () => saveBakongToken(db, owner, { version: 0, token: token(IN_90_DAYS, 'theirs') }, setup, NOW))
    await expectApiError(() => saveBakongToken(racing, owner, { version: 0, token: token(IN_90_DAYS, 'mine') }, setup, NOW), 409, 'VERSION_CONFLICT')
    expect((await getKhqrSettings(db, TEST_TENANT, true)).token?.version).toBe(1)
  })

  it('refuses a token that has expired, and keeps one without a date', async () => {
    await expectApiError(() => saveBakongToken(db, owner, { version: 0, token: token(new Date(NOW.getTime() - 1000)) }, setup, NOW), 422, 'VALIDATION_FAILED', ['token'])
    expect(await hasBakongToken(db, TEST_TENANT)).toBe(false)
    const saved = await saveBakongToken(db, owner, { version: 0, token: 'opaque-token-without-a-date' }, setup, NOW)
    expect(saved.token).toMatchObject({ version: 1, expiresAt: null })
  })

  it('without a usable server key, nothing is stored', async () => {
    await expectApiError(() => saveBakongToken(db, owner, { version: 0, token: token(IN_90_DAYS) }, { ...setup, encryptionKey: '' }, NOW), 503, 'BAKONG_KEY_MISSING')
    await expectApiError(() => saveBakongToken(db, owner, { version: 0, token: token(IN_90_DAYS) }, { ...setup, encryptionKey: btoa('short') }, NOW), 503, 'BAKONG_KEY_MISSING')
    expect(await hasBakongToken(db, TEST_TENANT)).toBe(false)
    expect((await getKhqrSettings(db, TEST_TENANT, false)).tokenStorage).toBe(false)
  })
})

describe('removing it', () => {
  it('at the version read; the check turns off; audited', async () => {
    await saveBakongToken(db, owner, { version: 0, token: token(IN_90_DAYS) }, setup, NOW)
    await expectApiError(() => removeBakongToken(db, owner, { version: 2 }, setup), 409, 'VERSION_CONFLICT')
    const settings = await removeBakongToken(db, owner, { version: 1 }, setup)
    expect(settings).toMatchObject({ automaticCheck: false, token: null })
    expect(await tenantBakongClient(db, TEST_TENANT, setup)).toBeNull()
    expect((await db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.targetType, 'bakong_token'))).map(a => a.action))
      .toEqual(['orders.bakong_token.set', 'orders.bakong_token.remove'])
  })
})

describe('one cafe\'s token is never another\'s', () => {
  it('each cafe asks Bakong with its own; a cafe without one has none', async () => {
    await saveBakongToken(db, owner, { version: 0, token: token(IN_90_DAYS, 'nuk') }, setup, NOW)
    expect(await tenantBakongClient(db, 'tenant-2', setup)).toBeNull()
    expect(await getKhqrSettings(db, 'tenant-2', true)).toMatchObject({ automaticCheck: false, token: null })
    // A replace from the other cafe can't reach this one's row: it has none of its own at version 1.
    await expectApiError(() => saveBakongToken(db, otherOwner, { version: 1, token: token(IN_90_DAYS, 'brown') }, setup, NOW), 409, 'VERSION_CONFLICT')
    await expectApiError(() => removeBakongToken(db, otherOwner, { version: 1 }, setup), 409, 'VERSION_CONFLICT')

    await saveBakongToken(db, otherOwner, { version: 0, token: token(IN_90_DAYS, 'brown') }, setup, NOW)
    await (await tenantBakongClient(db, TEST_TENANT, setup))!.checkByMd5('a'.repeat(32))
    await (await tenantBakongClient(db, 'tenant-2', setup))!.checkByMd5('a'.repeat(32))
    expect(asked).toEqual([`Bearer ${token(IN_90_DAYS, 'nuk')}`, `Bearer ${token(IN_90_DAYS, 'brown')}`])
    expect((await bakongTokenExpiries(db)).map(row => row.tenantId).sort()).toEqual([TEST_TENANT, 'tenant-2'])
  })

  it('a sealed token copied into another cafe\'s row, or under another key, doesn\'t open: the check says "key"', async () => {
    await saveBakongToken(db, owner, { version: 0, token: token(IN_90_DAYS, 'nuk') }, setup, NOW)
    const [row] = await db.select().from(bakongTokens).where(eq(bakongTokens.tenantId, TEST_TENANT))
    await db.insert(bakongTokens).values({ ...row!, tenantId: 'tenant-2', updatedBy: otherOwner.userId })

    const copied = await tenantBakongClient(db, 'tenant-2', setup)
    expect(await copied!.checkByMd5('a'.repeat(32))).toMatchObject({ kind: 'unavailable', problem: 'key' })
    const rekeyed = await tenantBakongClient(db, TEST_TENANT, { ...setup, encryptionKey: OTHER_KEY })
    expect(await rekeyed!.checkByMd5('a'.repeat(32))).toMatchObject({ kind: 'unavailable', problem: 'key' })
    const keyless = await tenantBakongClient(db, TEST_TENANT, { ...setup, encryptionKey: '' })
    expect(await keyless!.checkByMd5('a'.repeat(32))).toMatchObject({ kind: 'unavailable', problem: 'key' })
    expect(asked).toEqual([])
  })
})
