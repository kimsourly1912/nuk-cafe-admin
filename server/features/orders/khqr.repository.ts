import { and, desc, eq, gt } from 'drizzle-orm'
import type { KhqrCurrency } from '#shared/contracts/orders'
import { user } from '#server/db/tables'
import type { Db, Statement } from '#server/utils/batch'
import { availableLease } from '#server/utils/claims'
import { byId, firstRow, inTenant } from '#server/utils/query'
import { bakongTokens, khqrCharges, khqrSettings } from './orders.schema'

export interface KhqrSettingsRow {
  enabled: boolean
  accountId: string
  merchantName: string
  merchantCity: string
  currencies: KhqrCurrency[]
  version: number
  updatedAt: Date
  updatedByName: string
}

/** The tenant's settings (one row per tenant, D137). */
export async function findSettings(db: Db, tenantId: string): Promise<KhqrSettingsRow | undefined> {
  const row = await firstRow(db.select({
    enabled: khqrSettings.enabled,
    accountId: khqrSettings.accountId,
    merchantName: khqrSettings.merchantName,
    merchantCity: khqrSettings.merchantCity,
    currencies: khqrSettings.currencies,
    version: khqrSettings.version,
    updatedAt: khqrSettings.updatedAt,
    updatedByName: user.name,
  }).from(khqrSettings).innerJoin(user, eq(user.id, khqrSettings.updatedBy)).where(eq(khqrSettings.tenantId, tenantId)))
  return row && { ...row, currencies: row.currencies.split(',') as KhqrCurrency[] }
}

export interface SettingsValues {
  enabled: boolean
  accountId: string
  merchantName: string
  merchantCity: string
  currencies: KhqrCurrency[]
  updatedBy: string
  updatedAt: Date
}

const columns = (values: SettingsValues) => ({ ...values, currencies: values.currencies.join(',') })

/** The first save: inserts the row unless someone else just did (then nothing changes: the guard after it fails). */
export function insertSettingsStatement(db: Db, tenantId: string, values: SettingsValues): Statement {
  return db.insert(khqrSettings).values({ tenantId, ...columns(values), version: 1 }).onConflictDoNothing()
}

/** A later save: only from the version the page read. */
export function updateSettingsStatement(db: Db, tenantId: string, version: number, values: SettingsValues): Statement {
  return db.update(khqrSettings).set({ ...columns(values), version: version + 1 })
    .where(and(eq(khqrSettings.tenantId, tenantId), eq(khqrSettings.version, version)))
}

// --- The cafe's Bakong token (T2d, D148): sealed, never read in clear here ---

export interface BakongTokenRow {
  sealed: string
  expiresAt: Date | null
  version: number
  updatedAt: Date
  updatedByName: string
}

export function findBakongToken(db: Db, tenantId: string): Promise<BakongTokenRow | undefined> {
  return firstRow(db.select({
    sealed: bakongTokens.sealed,
    expiresAt: bakongTokens.expiresAt,
    version: bakongTokens.version,
    updatedAt: bakongTokens.updatedAt,
    updatedByName: user.name,
  }).from(bakongTokens).innerJoin(user, eq(user.id, bakongTokens.updatedBy)).where(eq(bakongTokens.tenantId, tenantId)))
}

/** Across cafes: every saved token's expiry, for System health (no sealed tokens read). */
export function bakongTokenExpiries(db: Db): Promise<{ tenantId: string, expiresAt: Date | null }[]> {
  return db.select({ tenantId: bakongTokens.tenantId, expiresAt: bakongTokens.expiresAt }).from(bakongTokens)
}

/** The cafe's token expiry (`null`: none set), for its reminder; `undefined` without a token. */
export function findBakongTokenExpiry(db: Db, tenantId: string): Promise<{ expiresAt: Date | null } | undefined> {
  return firstRow(db.select({ expiresAt: bakongTokens.expiresAt }).from(bakongTokens).where(eq(bakongTokens.tenantId, tenantId)))
}

export interface BakongTokenValues {
  sealed: string
  expiresAt: Date | null
  updatedBy: string
  updatedAt: Date
}

/** The first token: inserted unless someone else just saved one (then the guard after it fails). */
export function insertBakongTokenStatement(db: Db, tenantId: string, values: BakongTokenValues): Statement {
  return db.insert(bakongTokens).values({ tenantId, ...values, version: 1 }).onConflictDoNothing()
}

/** A replacement: only at the version the page read. */
export function updateBakongTokenStatement(db: Db, tenantId: string, version: number, values: BakongTokenValues): Statement {
  return db.update(bakongTokens).set({ ...values, version: version + 1 })
    .where(and(eq(bakongTokens.tenantId, tenantId), eq(bakongTokens.version, version)))
}

/** Removal: only at the version the page read. */
export function deleteBakongTokenStatement(db: Db, tenantId: string, version: number): Statement {
  return db.delete(bakongTokens).where(and(eq(bakongTokens.tenantId, tenantId), eq(bakongTokens.version, version)))
}

export interface ChargeRow {
  id: string
  orderId: string
  branchId: string
  currency: KhqrCurrency
  amount: number
  khrPerUsd: number | null
  accountId: string
  merchantName: string
  qr: string
  md5: string
  billNumber: string
  createdAt: Date
  expiresAt: Date
}

const chargeColumns = {
  id: khqrCharges.id,
  orderId: khqrCharges.orderId,
  branchId: khqrCharges.branchId,
  currency: khqrCharges.currency,
  amount: khqrCharges.amount,
  khrPerUsd: khqrCharges.khrPerUsd,
  accountId: khqrCharges.accountId,
  merchantName: khqrCharges.merchantName,
  qr: khqrCharges.qr,
  md5: khqrCharges.md5,
  billNumber: khqrCharges.billNumber,
  createdAt: khqrCharges.createdAt,
  expiresAt: khqrCharges.expiresAt,
}

/** The order's latest QR in a currency that still works after `after` (`khqr_charges_order_idx`). */
export function findOpenCharge(db: Db, tenantId: string, orderId: string, currency: KhqrCurrency, after: Date): Promise<ChargeRow | undefined> {
  return firstRow(db.select(chargeColumns).from(khqrCharges)
    .where(inTenant(khqrCharges, tenantId, eq(khqrCharges.orderId, orderId), eq(khqrCharges.currency, currency), gt(khqrCharges.expiresAt, after)))
    .orderBy(desc(khqrCharges.createdAt)))
}

export function findCharge(db: Db, tenantId: string, id: string): Promise<ChargeRow | undefined> {
  return firstRow(db.select(chargeColumns).from(khqrCharges).where(byId(khqrCharges, tenantId, id)))
}

/**
 * The turn to ask Bakong about this QR until `until` (audit S5): one conditional update, so of the
 * counters asking at once only one wins, on every Worker. False while another's turn lasts.
 */
export async function claimBakongCheck(db: Db, tenantId: string, id: string, until: Date, now: Date): Promise<boolean> {
  const claimed = await db.update(khqrCharges)
    .set({ bakongCheckUntil: until })
    .where(inTenant(khqrCharges, tenantId, eq(khqrCharges.id, id), availableLease(khqrCharges.bakongCheckUntil, now)))
    .returning({ id: khqrCharges.id })
  return claimed.length > 0
}

export type NewCharge = ChargeRow & { tenantId: string, createdBy: string }

/** A new QR for an order; the service makes its id, so the response needs no read back. */
export function insertChargeStatement(db: Db, charge: NewCharge): Statement {
  return db.insert(khqrCharges).values(charge)
}
