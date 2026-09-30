import type { PaymentMethod } from '#shared/contracts/orders'
import { PAYMENT_METHODS } from '#shared/contracts/orders'
import type { ItemSalesQuery, ItemSalesReport, OrderHistory, OrderHistoryDetail, OrderHistoryQuery, ReportContext, ReportPeriodQuery, ReportSummary } from '#shared/contracts/reports'
import { REPORT_BEST_SELLERS } from '#shared/contracts/reports'
import { totalPages } from '#shared/contracts/common'
import type { Db } from '../../utils/batch'
import { notFound } from '../../utils/errors'
import { toIso } from '../../utils/time'
import { orderNotFound } from './orders.errors'
import * as orderRepo from './orders.repository'
import * as repo from './reports.repository'
import { averageMinor, bestSellers, businessDateAt, categoriesOf, firstName, itemSalesRows, itemSalesTable, paymentState, periodInstants, previousPeriod, salesTrend } from './reports.rules'

/**
 * The reports (step 8.1, docs/plans/reports.md, D110): one branch, a range of business dates, read
 * as of one instant. Every metric's definition and the date it counts on are in the plan. Admins
 * only (`report: ['read']`, checked by the routes).
 */

interface Context extends ReportContext {
  range: { branchId: string, start: Date, end: Date }
}

async function context(db: Db, query: ReportPeriodQuery, now: Date): Promise<Context> {
  const branch = await repo.findReportBranch(db, query.branchId)
  if (!branch) throw notFound('This branch')
  const { start, end } = periodInstants(query, branch.timeZone)
  return {
    branch,
    period: { from: query.from, to: query.to, start: toIso(start), end: toIso(end) },
    asOf: toIso(now),
    range: { branchId: branch.id, start, end },
  }
}

const reportContext = ({ range: _, ...rest }: Context): ReportContext => rest

export async function reportSummary(db: Db, query: ReportPeriodQuery, now = new Date()): Promise<ReportSummary> {
  const ctx = await context(db, query, now)
  const previous = periodInstants(previousPeriod(query), ctx.branch.timeZone)
  const today = businessDateAt(now, ctx.branch.timeZone)
  const includesToday = query.from <= today && today <= query.to
  const dates = { branchId: ctx.branch.id, from: query.from, to: query.to }

  const [payments, refunds, previousPaidSalesMinor, paidItems, placed, cancelled, current] = await Promise.all([
    repo.paymentsCollected(db, ctx.range),
    repo.refundsReturned(db, ctx.range),
    repo.paidSalesTotal(db, { branchId: ctx.branch.id, ...previous }),
    repo.itemTotals(db, ctx.range, 'collected'),
    repo.ordersPlaced(db, dates),
    repo.cancelledUnpaid(db, dates),
    includesToday ? repo.currentCounts(db, ctx.branch.id, now) : Promise.resolve(null),
  ])

  const salesMinor = payments.reduce((sum, p) => sum + p.amountMinor, 0)
  const byMethod = (method: PaymentMethod) => {
    const of = payments.filter(p => p.method === method)
    return {
      method,
      orders: of.length,
      amountMinor: of.reduce((sum, p) => sum + p.amountMinor, 0),
      amountKhr: method === 'cash_khr' ? of.reduce((sum, p) => sum + (p.amountKhr ?? 0), 0) : null,
    }
  }
  const cancelledBy = (by: 'customer' | 'cafe' | 'system') => cancelled.find(row => row.by === by)?.n ?? 0
  const currentOf = (status: 'awaiting_payment' | 'preparing' | 'ready') => current?.find(row => row.status === status)?.n ?? 0

  return {
    ...reportContext(ctx),
    paid: { salesMinor, orders: payments.length, averageMinor: averageMinor(salesMinor, payments.length) },
    refunds,
    netSalesMinor: salesMinor - refunds.amountMinor,
    previousPaidSalesMinor,
    trend: salesTrend(payments, query, ctx.branch.timeZone),
    payments: PAYMENT_METHODS.map(byMethod),
    bestSellers: bestSellers(itemSalesRows(paidItems, []), REPORT_BEST_SELLERS),
    cancelledUnpaid: { customer: cancelledBy('customer'), cafe: cancelledBy('cafe'), system: cancelledBy('system') },
    ordersPlaced: placed,
    current: current ? { awaitingPayment: currentOf('awaiting_payment'), preparing: currentOf('preparing'), ready: currentOf('ready') } : null,
  }
}

/** Sales by item: paid line totals and refunded ones per item, filtered, sorted, a page of them. */
export async function itemSalesReport(db: Db, query: ItemSalesQuery, now = new Date()): Promise<ItemSalesReport> {
  const ctx = await context(db, query, now)
  const [paid, refunded] = await Promise.all([
    repo.itemTotals(db, ctx.range, 'collected'),
    repo.itemTotals(db, ctx.range, 'returned'),
  ])
  const all = itemSalesRows(paid, refunded)
  const { rows, totals } = itemSalesTable(all, query)
  return {
    ...reportContext(ctx),
    items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: rows.length,
    totalPages: totalPages(rows.length, query.pageSize),
    totals,
    categories: categoriesOf(all),
  }
}

/** Orders placed in the business dates, with their payment and progress. */
export async function orderHistory(db: Db, query: OrderHistoryQuery, now = new Date()): Promise<OrderHistory> {
  const ctx = await context(db, query, now)
  const { rows, total } = await repo.orderHistory(db, query)
  return {
    ...reportContext(ctx),
    orders: rows.map(row => ({
      id: row.id,
      pickupNumber: row.pickupNumber,
      businessDate: row.businessDate,
      placedAt: toIso(row.placedAt),
      orderType: row.orderType,
      tableLabel: row.tableLabel,
      payment: { state: paymentState(row.status, row.paymentId ? { returnedAt: row.returnedAt } : null), method: row.method },
      status: row.status,
      totalMinor: row.totalMinor,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: totalPages(total, query.pageSize),
  }
}

/** One order as sold: its lines, payment, and every recorded step with who took it. */
export async function orderHistoryDetail(db: Db, id: string): Promise<OrderHistoryDetail> {
  const order = await orderRepo.findOrder(db, id)
  if (!order) throw orderNotFound()
  const [branch, lines, [payment], events, returnedBy] = await Promise.all([
    repo.findReportBranch(db, order.branchId),
    orderRepo.linesOf(db, id),
    orderRepo.paymentsOf(db, [id]),
    repo.eventsOf(db, id),
    repo.returnedByName(db, id),
  ])
  return {
    id: order.id,
    branch: branch!,
    pickupNumber: order.pickupNumber,
    businessDate: order.businessDate,
    placedAt: toIso(order.placedAt),
    orderType: order.orderType,
    tableLabel: order.tableLabel,
    customerFirstName: firstName(order.customerName),
    status: order.status,
    totalMinor: order.totalMinor,
    lines: lines.map(line => ({
      itemName: line.itemName,
      categoryName: line.categoryName,
      detail: line.detail,
      modifiers: line.modifiers.map(m => ({ name: m.name, priceDeltaMinor: m.priceDeltaMinor })),
      unitPriceMinor: line.unitPriceMinor,
      quantity: line.quantity,
      totalMinor: line.totalMinor,
      note: line.note,
    })),
    payment: {
      state: paymentState(order.status, payment ?? null),
      method: payment?.method ?? null,
      amountMinor: payment?.amountMinor ?? null,
      amountKhr: payment?.amountKhr ?? null,
      khrPerUsd: payment?.khrPerUsd ?? null,
      reference: payment?.reference ?? null,
      collectedAt: payment ? toIso(payment.collectedAt) : null,
      collectedBy: payment?.collectedByName ?? null,
      returnMethod: payment?.returnMethod ?? null,
      returnedAt: payment?.returnedAt ? toIso(payment.returnedAt) : null,
      returnedBy,
    },
    timeline: events.map(event => ({
      at: toIso(event.at),
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      by: event.actorId === null
        ? { kind: 'system' as const, name: null }
        : event.actorId === order.customerId
          ? { kind: 'customer' as const, name: firstName(order.customerName) }
          : { kind: 'staff' as const, name: event.actorName },
      reason: event.reason,
      note: event.note,
    })),
  }
}
