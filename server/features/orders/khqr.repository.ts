import { and, desc, eq, gt } from 'drizzle-orm'
import type { KhqrCurrency } from '#shared/contracts/orders'
import { user } from '#server/db/tables'
import type { Db, Statement } from '#server/utils/batch'
import { khqrCharges, khqrSettings } from './orders.schema'

/** All SQL of KHQR at the counter (step 10.15, D130). */

const SETTINGS_ID = 'default'

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

export async function findSettings(db: Db): Promise<KhqrSettingsRow | undefined> {
  const [row] = await db.select({
    enabled: khqrSettings.enabled,
    accountId: khqrSettings.accountId,
    merchantName: khqrSettings.merchantName,
    merchantCity: khqrSettings.merchantCity,
    currencies: khqrSettings.currencies,
    version: khqrSettings.version,
    updatedAt: khqrSettings.updatedAt,
    updatedByName: user.name,
  }).from(khqrSettings).innerJoin(user, eq(user.id, khqrSettings.updatedBy)).where(eq(khqrSettings.id, SETTINGS_ID))
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
export function insertSettingsStatement(db: Db, values: SettingsValues): Statement {
  return db.insert(khqrSettings).values({ id: SETTINGS_ID, ...columns(values), version: 1 }).onConflictDoNothing()
}

/** A later save: only from the version the page read. */
export function updateSettingsStatement(db: Db, version: number, values: SettingsValues): Statement {
  return db.update(khqrSettings).set({ ...columns(values), version: version + 1 })
    .where(and(eq(khqrSettings.id, SETTINGS_ID), eq(khqrSettings.version, version)))
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

export async function findCharge(db: Db, id: string): Promise<ChargeRow | undefined> {
  const [row] = await db.select(chargeColumns).from(khqrCharges).where(eq(khqrCharges.id, id))
  return row
}

export type NewCharge = Omit<ChargeRow, 'id'> & { createdBy: string }

export async function insertCharge(db: Db, charge: NewCharge): Promise<ChargeRow> {
  const [row] = await db.insert(khqrCharges).values(charge).returning(chargeColumns)
  return row!
}
