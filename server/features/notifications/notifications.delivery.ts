import type { Api } from 'grammy'
import { GrammyError, InputFile } from 'grammy'
import type { DeliverySnapshot, NotificationDelivery, NotificationKind, NotificationRule, SetNotificationRuleInput } from '#shared/contracts/notifications'
import { DELIVERY_MAX_ATTEMPTS } from '#shared/contracts/notifications'
import { getBranchSettings } from '#server/features/branches'
import type { Actor } from '#server/features/identity'
import { orderAlert, reportBranches, reportMessage } from '#server/features/orders'
import { auditStatement, retryDelayMs } from '#server/features/platform'
import type { Db, Statement } from '#server/utils/batch'
import { apiError, ErrorCodes } from '#server/utils/errors'
import { newId } from '#server/utils/ids'
import { log } from '#server/utils/log'
import { toIso } from '#server/utils/time'
import { addDays } from '#server/utils/weekly-windows'
import { destinationBlocked, destinationNotFound } from './notifications.errors'
import { alertSubject, CLOSING_SUMMARY_DELAY_MINUTES, CLOSING_SUMMARY_WINDOW_HOURS, closingInstant, newOrderMessage, paymentMessage } from './notifications.messages'
import * as repo from './notifications.repository'
import { isBlockedError, plainText } from './notifications.rules'
import type { StoredMessage } from './notifications.schema'

/**
 * Notifications (step 8.1d, D113): new-order and payment alerts, the closing summary, and their
 * delivery. Every message is saved as a delivery before it's sent (one per chat and subject), then
 * sent by `deliverDue` with retries: Telegram's wait respected, a blocked chat marked, 8 tries at
 * most. At least once: a lost answer after Telegram accepted a message can repeat it.
 */

const MINUTE = 60_000
/** How long a run holds a delivery while sending it. */
const CLAIM_MS = 2 * MINUTE

// --- Sending ---

/** Sends a saved message: the text (with its link button), then its file. */
export async function sendStored(api: Api, chatId: string, message: StoredMessage): Promise<void> {
  if (message.html) {
    await api.sendMessage(chatId, message.html, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: message.button ? { inline_keyboard: [[{ text: message.button.text, url: message.button.url }]] } : undefined,
    })
  }
  if (message.document) {
    await api.sendDocument(chatId, new InputFile(new TextEncoder().encode(message.document.content), message.document.filename))
  }
}

export interface DeliveryReport {
  sent: number
  retried: number
  failed: number
}

/**
 * Sends the deliveries that are due (`ids`: only those, e.g. right after they were queued). Each is
 * claimed first, so overlapping runs never send one twice at once. Never throws for Telegram's
 * answers: they become the delivery's state.
 */
export async function deliverDue(db: Db, api: Api, now = new Date(), options: { limit?: number, ids?: string[] } = {}): Promise<DeliveryReport> {
  const report = { sent: 0, retried: 0, failed: 0 }
  if (options.ids && !options.ids.length) return report
  for (const row of await repo.dueDeliveries(db, now, options.limit ?? 25, options.ids)) {
    if (!await repo.claimDelivery(db, row, now, new Date(now.getTime() + CLAIM_MS))) continue
    const attempt = row.attempts + 1
    const destination = await repo.findDestination(db, row.destinationId)
    if (!destination || destination.status !== 'connected') {
      await repo.markFailed(db, row.id, destination?.status === 'blocked' ? 'The bot was removed or blocked in this chat.' : 'This chat was disconnected.')
      report.failed++
      continue
    }
    try {
      await sendStored(api, destination.chatId, row.message)
      await repo.markDelivered(db, row.id, destination.id, new Date())
      report.sent++
    }
    catch (error) {
      log('warn', 'Telegram: a notification was not delivered', { deliveryId: row.id, attempt, error: String(error) })
      if (isBlockedError(error)) {
        await repo.markBlocked(db, destination.chatId, now)
        await repo.markFailed(db, row.id, 'The bot was removed or blocked in this chat.')
        report.failed++
      }
      else if (error instanceof GrammyError && error.error_code === 429) {
        // Telegram's flood control says when: that wait doesn't count against the tries.
        const seconds = error.parameters.retry_after ?? 30
        await repo.markRetry(db, row.id, new Date(now.getTime() + seconds * 1000), `Telegram asked to wait ${seconds} seconds.`)
        report.retried++
      }
      else if (attempt >= DELIVERY_MAX_ATTEMPTS) {
        await repo.markFailed(db, row.id, `Telegram didn't accept it after ${attempt} tries.`)
        report.failed++
      }
      else {
        await repo.markRetry(db, row.id, new Date(now.getTime() + retryDelayMs(attempt)), 'Telegram didn\'t accept it. Trying again.')
        report.retried++
      }
    }
  }
  return report
}

// --- Alerts (the orders' outbox events) ---

/**
 * An order's alert to every chat that gets `kind`, saved as deliveries (a repeated event adds
 * nothing: one per chat and order). Returns the new deliveries' ids, to send at once.
 */
export async function queueOrderAlert(db: Db, kind: Extract<NotificationKind, 'new_order' | 'payment'>, orderId: string, siteUrl?: string, now = new Date()): Promise<string[]> {
  const targets = await repo.targetsOf(db, kind)
  if (!targets.length) return []
  const alert = await orderAlert(db, orderId)
  if (!alert) return []
  const dedupeKey = `${kind}:${orderId}`
  const done = await repo.deliveredTo(db, dedupeKey, targets.map(t => t.destinationId))
  const message = kind === 'new_order' ? newOrderMessage(alert, siteUrl) : paymentMessage(alert, siteUrl)
  const deliveries = targets.filter(t => !done.has(t.destinationId)).map((target): repo.NewDelivery => ({
    id: newId(),
    kind,
    destinationId: target.destinationId,
    dedupeKey,
    subject: alertSubject(kind, alert),
    message,
    createdAt: now,
    nextAttemptAt: now,
  }))
  if (deliveries.length) await db.batch(deliveries.map(d => repo.insertDeliveryStatement(db, d)) as [Statement, ...Statement[]])
  return deliveries.map(d => d.id)
}

// --- The closing summary ---

/**
 * Queues each branch's closing summary once it's due: 30 minutes after the business day's last
 * opening window ends, for 12 hours (not sent late after downtime), never on a closed day (R4).
 * The Summary is read once and saved: a retry resends the same figures. Checked every minute; the
 * dedupe key keeps it to one per branch, business date and chat.
 */
export async function queueClosingSummaries(db: Db, siteUrl?: string, now = new Date()): Promise<string[]> {
  const targets = await repo.targetsOf(db, 'closing_summary')
  if (!targets.length) return []
  const queued: string[] = []
  for (const branch of await reportBranches(db, now)) {
    const settings = await getBranchSettings(db, branch.id, now)
    for (const date of [addDays(branch.today, -1), branch.today]) {
      const closing = closingInstant(settings.hours, date, branch.timeZone)
      if (!closing) continue
      const due = closing.getTime() + CLOSING_SUMMARY_DELAY_MINUTES * MINUTE
      if (now.getTime() < due || now.getTime() >= due + CLOSING_SUMMARY_WINDOW_HOURS * 60 * MINUTE) continue

      const dedupeKey = `closing_summary:${branch.id}:${date}`
      const done = await repo.deliveredTo(db, dedupeKey, targets.map(t => t.destinationId))
      const missing = targets.filter(t => !done.has(t.destinationId))
      if (!missing.length) continue

      const report = await reportMessage(db, { kind: 'summary', query: { branchId: branch.id, from: date, to: date } }, { attachCsv: missing.some(t => t.attachCsv), title: 'Closing summary' }, now)
      const button = siteUrl?.startsWith('https://')
        ? { text: 'View full report', url: new URL(`/admin/reports/summary?from=${date}&to=${date}`, siteUrl).toString() }
        : undefined
      const deliveries: repo.NewDelivery[] = []
      for (const target of missing) {
        deliveries.push({ id: newId(), kind: 'closing_summary', destinationId: target.destinationId, dedupeKey, subject: report.subject, message: { html: report.html, button }, createdAt: now, nextAttemptAt: now })
        // The CSV as its own delivery: a failed file never sends the text twice.
        if (target.attachCsv && report.csv) {
          deliveries.push({ id: newId(), kind: 'closing_summary', destinationId: target.destinationId, dedupeKey: `${dedupeKey}:csv`, subject: `${report.subject} · CSV`, message: { html: '', document: { filename: report.csv.filename, content: report.csv.csv } }, createdAt: now, nextAttemptAt: new Date(now.getTime() + 1) })
        }
      }
      await db.batch(deliveries.map(d => repo.insertDeliveryStatement(db, d)) as [Statement, ...Statement[]])
      queued.push(...deliveries.map(d => d.id))
    }
  }
  return queued
}

// --- Rules ---

export async function listRules(db: Db): Promise<NotificationRule[]> {
  return (await repo.listRules(db)).map(rule => ({ kind: rule.kind, destinationId: rule.destinationId, attachCsv: rule.kind === 'closing_summary' && rule.attachCsv }))
}

/** Turns one notification on or off for one chat (and a closing summary's CSV). */
export async function setNotificationRule(db: Db, actor: Actor, input: SetNotificationRuleInput): Promise<NotificationRule[]> {
  const destination = await repo.findDestination(db, input.destinationId)
  if (!destination || destination.status === 'disconnected') throw destinationNotFound()
  if (input.enabled) {
    await repo.setRule(db, { kind: input.kind, destinationId: input.destinationId, attachCsv: input.kind === 'closing_summary' && input.attachCsv, createdBy: actor.userId })
  }
  else {
    await repo.removeRule(db, input.kind, input.destinationId)
  }
  await db.batch([auditStatement(db, actor, { action: 'notifications.rule.set', targetType: 'telegram_destination', targetId: input.destinationId, metadata: { kind: input.kind, enabled: input.enabled, attachCsv: input.attachCsv } })])
  return listRules(db)
}

// --- History ---

const HISTORY_LIMIT = 50

function deliveryOf(row: repo.DeliveryRow, title: string): NotificationDelivery {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    destination: { id: row.destinationId, title },
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.status === 'pending' ? toIso(row.nextAttemptAt) : null,
    lastError: row.lastError,
    createdAt: toIso(row.createdAt),
    sentAt: row.sentAt ? toIso(row.sentAt) : null,
  }
}

/** The latest 50 deliveries, newest first. */
export async function listDeliveries(db: Db): Promise<NotificationDelivery[]> {
  return (await repo.recentDeliveries(db, HISTORY_LIMIT)).map(row => deliveryOf(row.delivery, row.title))
}

/** A delivery's saved message as text (View snapshot). */
export async function deliverySnapshot(db: Db, id: string): Promise<DeliverySnapshot> {
  const row = await repo.findDelivery(db, id)
  if (!row) throw apiError(404, ErrorCodes.NOT_FOUND, 'This message was not found.')
  const { message } = row.delivery
  return { id, subject: row.delivery.subject, text: plainText(message.html), attachment: message.document?.filename ?? null }
}

/** Retry: a failed delivery is sent again (its saved message, not a new one). */
export async function retryDelivery(db: Db, api: Api, actor: Actor, id: string, now = new Date()): Promise<NotificationDelivery> {
  const row = await repo.findDelivery(db, id)
  if (!row) throw apiError(404, ErrorCodes.NOT_FOUND, 'This message was not found.')
  if (row.destinationStatus !== 'connected') throw destinationBlocked(row.title)
  if (!await repo.requeueFailed(db, id, now)) throw apiError(409, ErrorCodes.INVALID_STATE, 'This message isn\'t waiting for a retry: it was sent or is being tried already.')
  await db.batch([auditStatement(db, actor, { action: 'notifications.delivery.retry', targetType: 'notification_delivery', targetId: id })])
  await deliverDue(db, api, now, { ids: [id] })
  const after = (await repo.findDelivery(db, id))!
  return deliveryOf(after.delivery, after.title)
}

/** History is kept 90 days. */
export async function purgeDeliveries(db: Db, now = new Date()): Promise<number> {
  return repo.deleteDeliveriesBefore(db, new Date(now.getTime() - 90 * 24 * 60 * MINUTE))
}
