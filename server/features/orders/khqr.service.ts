import type { CreateKhqrInput, KhqrCharge, KhqrSettings, KhqrSettingsInput } from '#shared/contracts/orders'
import { KHQR_LIFETIME_MINUTES, toRiel } from '#shared/contracts/orders'
import type { Db } from '#server/utils/batch'
import { requireOneChange, runBatch } from '#server/utils/batch'
import { toIso } from '#server/utils/time'
import type { Actor, BranchActor } from '#server/features/identity'
import { auditStatement } from '#server/features/platform'
import { buildKhqr, KHQR_LIMITS } from './khqr'
import * as khqrRepo from './khqr.repository'
import { khqrChargeInvalid, khqrNotSetUp, khqrSettingsChanged, noExchangeRate, orderChanged, orderNotFound, paymentExpired } from './orders.errors'
import * as repo from './orders.repository'
import * as reportsRepo from './reports.repository'

/**
 * KHQR at the counter (step 10.15, D130): an admin sets the Bakong account that receives the money;
 * the counter shows a QR made for one order, holding its total, its number and an expiry; the
 * cashier confirms once the money shows in the bank app (10.15b checks with Bakong instead). The
 * money goes straight from the customer's bank to that account: nothing here holds or moves it.
 */

const toSettings = (row: khqrRepo.KhqrSettingsRow | undefined): KhqrSettings => row
  ? {
      version: row.version,
      enabled: row.enabled,
      accountId: row.accountId,
      merchantName: row.merchantName,
      merchantCity: row.merchantCity,
      currencies: row.currencies,
      updatedAt: toIso(row.updatedAt),
      updatedBy: { name: row.updatedByName },
    }
  : { version: 0, enabled: false, accountId: null, merchantName: null, merchantCity: null, currencies: [], updatedAt: null, updatedBy: null }

export async function getKhqrSettings(db: Db): Promise<KhqrSettings> {
  return toSettings(await khqrRepo.findSettings(db))
}

/** Saves the account and what customers see (`settings: ['manage']`), from the version the page read; audited. */
export async function saveKhqrSettings(db: Db, actor: Actor, input: KhqrSettingsInput, now = new Date()): Promise<KhqrSettings> {
  const before = await khqrRepo.findSettings(db)
  if ((before?.version ?? 0) !== input.version) throw khqrSettingsChanged()
  const { version, ...rest } = input
  const values = { ...rest, updatedBy: actor.userId, updatedAt: now }
  await runBatch(db, [
    version === 0 ? khqrRepo.insertSettingsStatement(db, values) : khqrRepo.updateSettingsStatement(db, version, values),
    requireOneChange(db),
    auditStatement(db, actor, {
      action: 'orders.khqr_settings.save',
      targetType: 'khqr_settings',
      metadata: { from: before ? { enabled: before.enabled, accountId: before.accountId, merchantName: before.merchantName, merchantCity: before.merchantCity, currencies: before.currencies } : null, to: rest },
    }),
  ], khqrSettingsChanged)
  return getKhqrSettings(db)
}

/** What the counter needs to know: the currencies offered, or `null` while KHQR isn't on. */
export async function counterKhqr(db: Db): Promise<{ currencies: KhqrSettings['currencies'] } | null> {
  const settings = await khqrRepo.findSettings(db)
  return settings?.enabled ? { currencies: settings.currencies } : null
}

const toCharge = (row: khqrRepo.ChargeRow): KhqrCharge => ({
  id: row.id,
  currency: row.currency,
  amount: row.amount,
  khrPerUsd: row.khrPerUsd,
  qr: row.qr,
  billNumber: row.billNumber,
  merchantName: row.merchantName,
  createdAt: toIso(row.createdAt),
  expiresAt: toIso(row.expiresAt),
})

/** A QR answered again only while it still has this long to go: less, and a new one is made. */
const MIN_REMAINING_MS = 60_000

/**
 * The QR for an unpaid order in a currency (`payment: ['collect']`): the open one if it still has a
 * minute to go and the account hasn't changed since, otherwise a new one, working 15 minutes or
 * until the order's time to pay is over. Riel at the current rate, rounded up to ៛100 as cash riel.
 * Two cashiers at once may make two: both are this order's, and either can be paid.
 */
export async function createKhqrCharge(db: Db, actor: BranchActor, orderId: string, input: CreateKhqrInput, now = new Date()): Promise<KhqrCharge> {
  const order = await repo.findOrder(db, orderId)
  if (!order || order.branchId !== actor.branchId) throw orderNotFound()
  if (order.status !== 'awaiting_payment') throw orderChanged(order.pickupNumber, order.status)
  if (order.paymentDueAt.getTime() <= now.getTime()) throw paymentExpired()

  const settings = await khqrRepo.findSettings(db)
  if (!settings?.enabled) throw khqrNotSetUp()
  if (!settings.currencies.includes(input.currency)) throw khqrNotSetUp(input.currency)

  const open = await khqrRepo.findOpenCharge(db, orderId, input.currency, new Date(now.getTime() + MIN_REMAINING_MS))
  if (open && open.accountId === settings.accountId && open.merchantName === settings.merchantName) return toCharge(open)

  let amount = order.totalMinor
  let khrPerUsd: number | null = null
  if (input.currency === 'KHR') {
    const rate = await repo.currentRate(db, now)
    if (!rate) throw noExchangeRate()
    khrPerUsd = rate.perUsd
    amount = toRiel(order.totalMinor, rate.perUsd)
  }

  const branch = await reportsRepo.findReportBranch(db, actor.branchId)
  const billNumber = `Order ${String(order.pickupNumber).padStart(3, '0')}`
  const expiresAt = new Date(Math.min(now.getTime() + KHQR_LIFETIME_MINUTES * 60_000, order.paymentDueAt.getTime()))
  const { qr, md5 } = buildKhqr({
    accountId: settings.accountId,
    merchantName: settings.merchantName,
    merchantCity: settings.merchantCity,
    currency: input.currency,
    amount,
    billNumber,
    storeLabel: (branch?.name ?? settings.merchantName).replace(/[^\x20-\x7E]/g, '').trim().slice(0, KHQR_LIMITS.storeLabel) || settings.merchantName,
    createdAt: now,
    expiresAt,
  })
  return toCharge(await khqrRepo.insertCharge(db, {
    orderId,
    branchId: actor.branchId,
    currency: input.currency,
    amount,
    khrPerUsd,
    accountId: settings.accountId,
    merchantName: settings.merchantName,
    qr,
    md5,
    billNumber,
    createdAt: now,
    expiresAt,
    createdBy: actor.userId,
  }))
}

/**
 * The QR a KHQR payment names must be this order's, made in this branch. Its expiry doesn't block
 * the cashier: the customer may have paid at the last second, and the cashier only confirms money
 * they see arrive.
 */
export async function requireOrderCharge(db: Db, actor: BranchActor, orderId: string, chargeId: string): Promise<khqrRepo.ChargeRow> {
  const charge = await khqrRepo.findCharge(db, chargeId)
  if (!charge || charge.orderId !== orderId || charge.branchId !== actor.branchId) throw khqrChargeInvalid()
  return charge
}
