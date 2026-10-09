import type { BakongTokenInput, KhqrSettings, RemoveBakongTokenInput } from '#shared/contracts/orders'
import type { Db } from '#server/utils/batch'
import { requireOneChange, runBatch } from '#server/utils/batch'
import { log } from '#server/utils/log'
import type { Actor } from '#server/features/identity'
import { auditStatement } from '#server/features/platform'
import type { BakongClient } from './bakong'
import { bakongClient, bakongTokenExpiry } from './bakong'
import { BakongKeyError, BakongSealError, importBakongKey, openBakongToken, sealBakongToken } from './bakong-token'
import * as khqrRepo from './khqr.repository'
import { getKhqrSettings } from './khqr.service'
import { bakongKeyMissing, bakongTokenChanged, bakongTokenExpired } from './orders.errors'

/**
 * Each cafe's Bakong token (step T2d, D148): the cafe's owner pastes it on Payments; it is sealed
 * with the server's key before it reaches the database and never answered again, only its expiry
 * and who set it. The counter's check and Test connection open it per request, for that cafe only.
 * Replacing and removing name the version read (409 when someone changed it meanwhile); each change
 * is audited without the token.
 */

/** The server's side: `NUXT_BAKONG_API_URL` and `NUXT_BAKONG_ENCRYPTION_KEY` (empty: tokens can't be stored). */
export interface BakongSetup {
  apiUrl: string
  encryptionKey: string
  fetch?: typeof fetch
}

async function keyOf(setup: BakongSetup): Promise<CryptoKey> {
  if (!setup.encryptionKey.trim()) throw bakongKeyMissing()
  try {
    return await importBakongKey(setup.encryptionKey)
  }
  catch (error) {
    // A key that isn't 32 bytes of base64 is the platform team's to fix: never store under it.
    if (error instanceof BakongKeyError) {
      log('error', 'Bakong encryption key unusable', { reason: error.message })
      throw bakongKeyMissing()
    }
    throw error
  }
}

const storageOf = (setup: BakongSetup) => Boolean(setup.encryptionKey.trim())

/** Saves (or replaces) the cafe's token, sealed; refused when it has already expired. */
export async function saveBakongToken(db: Db, actor: Actor, input: BakongTokenInput, setup: BakongSetup, now = new Date()): Promise<KhqrSettings> {
  const key = await keyOf(setup)
  const before = await khqrRepo.findBakongToken(db, actor.tenantId)
  if ((before?.version ?? 0) !== input.version) throw bakongTokenChanged()
  const expiresAt = bakongTokenExpiry(input.token)
  if (expiresAt && expiresAt <= now) throw bakongTokenExpired(expiresAt)
  const values = { sealed: await sealBakongToken(key, actor.tenantId, input.token), expiresAt, updatedBy: actor.userId, updatedAt: now }
  await runBatch(db, [
    input.version === 0
      ? khqrRepo.insertBakongTokenStatement(db, actor.tenantId, values)
      : khqrRepo.updateBakongTokenStatement(db, actor.tenantId, input.version, values),
    requireOneChange(db),
    auditStatement(db, actor, {
      action: input.version === 0 ? 'orders.bakong_token.set' : 'orders.bakong_token.replace',
      targetType: 'bakong_token',
      // Never the token: only when it stops working.
      metadata: { expiresAt: expiresAt?.toISOString() ?? null },
    }),
  ], bakongTokenChanged)
  return getKhqrSettings(db, actor.tenantId, storageOf(setup))
}

/** Removes the cafe's token: the counter's check turns off and cashiers confirm by hand. */
export async function removeBakongToken(db: Db, actor: Actor, input: RemoveBakongTokenInput, setup: BakongSetup): Promise<KhqrSettings> {
  await runBatch(db, [
    khqrRepo.deleteBakongTokenStatement(db, actor.tenantId, input.version),
    requireOneChange(db),
    auditStatement(db, actor, { action: 'orders.bakong_token.remove', targetType: 'bakong_token', metadata: {} }),
  ], bakongTokenChanged)
  return getKhqrSettings(db, actor.tenantId, storageOf(setup))
}

/** Whether the cafe has a token (the counter's queue says if its check is on). */
export async function hasBakongToken(db: Db, tenantId: string): Promise<boolean> {
  return Boolean(await khqrRepo.findBakongToken(db, tenantId))
}

/** A client that answers every check with this problem: the callers say it like Bakong's own. */
const unavailableClient = (detail: string): BakongClient => ({
  checkByMd5: async () => ({ kind: 'unavailable', problem: 'key', detail }),
})

/**
 * The Bakong client with the cafe's own token; `null` when it has none (the cashier confirms by
 * hand). A token this server can't open (no key, another key, or another cafe's row) answers
 * `key`: Payments then asks for the token again.
 */
export async function tenantBakongClient(db: Db, tenantId: string, setup: BakongSetup): Promise<BakongClient | null> {
  const row = await khqrRepo.findBakongToken(db, tenantId)
  if (!row) return null
  let key: CryptoKey
  try {
    key = await keyOf(setup)
  }
  catch {
    return unavailableClient('This server has no usable NUXT_BAKONG_ENCRYPTION_KEY')
  }
  try {
    const token = await openBakongToken(key, tenantId, row.sealed)
    return bakongClient({ apiUrl: setup.apiUrl, token, fetch: setup.fetch })
  }
  catch (error) {
    if (!(error instanceof BakongSealError)) throw error
    log('error', 'Bakong token unreadable', { tenantId })
    return unavailableClient('The saved token doesn\'t open with this server\'s key')
  }
}

/** Every cafe's token expiry, for the reminders (D132, per cafe since D148). */
export async function bakongTokenExpiries(db: Db): Promise<{ tenantId: string, expiresAt: Date | null }[]> {
  return khqrRepo.bakongTokenExpiries(db)
}
