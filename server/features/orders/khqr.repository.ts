import { and, desc, eq, gt } from 'drizzle-orm'
import type { KhqrCurrency } from '#shared/contracts/orders'
import { user } from '#server/db/tables'
import type { Db, Statement } from '#server/utils/batch'
import { bakongTokens, khqrCharges, khqrSettings } from './orders.schema'

/** All SQL of KHQR at the counter (step 10.15, D130). */

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
  const [row] = await db.select({
    enabled: khqrSettings.enabled,
    accountId: khqrSettings.accountId,
    merchantName: khqrSettings.merchantName,
    merchantCity: khqrSettings.merchantCity,
    currencies: khqrSettings.currencies,
    version: khqrSettings.version,
    updatedAt: khqrSettings.updatedAt,
    updatedByName: user.name,
  }).from(khqrSettings).innerJoin(user, eq(user.id, khqrSettings.updatedBy)).where(eq(khqrSettings.tenantId, tenantId))
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

export async function findBakongToken(db: Db, tenantId: string): Promise<BakongTokenRow | undefined> {
  const [row] = await db.select({
    sealed: bakongTokens.sealed,
    expiresAt: bakongTokens.expiresAt,
    version: bakongTokens.version,
    updatedAt: bakongTokens.updatedAt,
    updatedByName: user.name,
  }).from(bakongTokens).innerJoin(user, eq(user.id, bakongTokens.updatedBy)).where(eq(bakongTokens.tenantId, tenantId))
  return row
}

/** Every cafe's token expiry, for the reminders (no sealed tokens read). */
export async function bakongTokenExpiries(db: Db): Promise<{ tenantId: string, expiresAt: Date | null }[]> {
  return db.select({ tenantId: bakongTokens.tenantId, expiresAt: bakongTokens.expiresAt }).from(bakongTokens)
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

/** The order's latest QR in a currency that still works after `after`. */
export async function findOpenCharge(db: Db, orderId: string, currency: KhqrCurrency, after: Date): Promise<ChargeRow | undefined> {
  const [row] = await db.select(chargeColumns).from(khqrCharges)
    .where(and(eq(khqrCharges.orderId, orderId), eq(khqrCharges.currency, currency), gt(khqrCharges.expiresAt, after)))
    .orderBy(desc(khqrCharges.createdAt)).limit(1)
  return row
}

export async function findCharge(db: Db, tenantId: string, id: string): Promise<ChargeRow | undefined> {
  const [row] = await db.select(chargeColumns).from(khqrCharges).where(and(eq(khqrCharges.tenantId, tenantId), eq(khqrCharges.id, id)))
  return row
}

export type NewCharge = Omit<ChargeRow, 'id'> & { tenantId: string, createdBy: string }

export async function insertCharge(db: Db, charge: NewCharge): Promise<ChargeRow> {
  const [row] = await db.insert(khqrCharges).values(charge).returning(chargeColumns)
  return row!
}
