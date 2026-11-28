import type { Api } from 'grammy'
import { GrammyError } from 'grammy'
import type { ReportSent } from '#shared/contracts/notifications'
import type { Actor } from '#server/features/identity'
import { auditStatement, withIdempotency } from '#server/features/platform'
import type { Db, Statement } from '#server/utils/batch'
import { requireOneChange, tryGuardedBatch } from '#server/utils/batch'
import { newId } from '#server/utils/ids'
import { log } from '#server/utils/log'
import { toIso } from '#server/utils/time'
import * as deliveries from './notifications.deliveries.repository'
import { destinationBlocked, destinationNotFound, reportDeliveryInProgress, reportDeliveryUncertain, telegramRateLimited } from './notifications.errors'
import * as destinations from './notifications.repository'
import { isBlockedError, sendFailure } from './notifications.rules'
import type { StoredMessage } from './notifications.schema'
import { sendStored } from './notifications.send'

// Manual sends have no scheduled retry. Keep them out of the old scheduler too, during a rollback.
const NEVER_DUE = new Date('9999-01-01T00:00:00Z')
const CHECK_WINDOW_MS = 2 * 60_000

type ReportRequest = { destinationId: string, report: unknown, attachCsv: boolean }
type BuiltReport = Pick<StoredMessage, 'html' | 'document'> & { subject: string, audit: Record<string, unknown> }

export function reportClaimStatus(row: deliveries.DeliveryRow, now: Date): 'pending' | 'uncertain' | 'failed' {
  if (row.claimToken) return (row.message.manualReport?.checkBy ?? 0) > now.getTime() ? 'pending' : 'uncertain'
  return row.lastError ? 'failed' : 'pending'
}

/** Reserve the snapshot and request key in one database batch, before any Telegram call. */
export async function sendReport(
  db: Db,
  api: Api,
  actor: Actor,
  key: string,
  request: ReportRequest,
  build: () => Promise<BuiltReport>,
  now?: Date,
): Promise<ReportSent> {
  const startedAt = now ?? new Date()
  const { response } = await withIdempotency<ReportSent | { deliveryId: string }>(
    db,
    { tenantId: actor.tenantId, actorId: actor.userId, operation: 'notifications.send-report', key },
    request,
    async () => {
      const destination = await destinations.findDestination(db, actor.tenantId, request.destinationId)
      if (!destination || destination.status === 'disconnected') throw destinationNotFound()
      if (destination.status !== 'connected') throw destinationBlocked(destination.title)
      const { subject, audit, ...message } = await build()
      const id = newId()
      return {
        statements: [
          deliveries.insertDeliveryStatement(db, {
            id, tenantId: actor.tenantId, kind: 'report', destinationId: destination.id,
            dedupeKey: `report:${id}`, subject,
            message: { ...message, manualReport: { audit: { ...audit, attachCsv: request.attachCsv } } },
            createdAt: startedAt, nextAttemptAt: NEVER_DUE,
          }),
          requireOneChange(db),
          auditStatement(db, actor, { action: 'report.queue', targetType: 'notification_delivery', targetId: id, metadata: { destinationId: destination.id, ...audit, attachCsv: request.attachCsv } }),
        ],
        response: { deliveryId: id },
      }
    },
    { now: startedAt },
  )
  // Keys committed before this change already contain a successful receipt.
  if (!('deliveryId' in response)) return response
  return sendReservedReport(db, api, actor, response.deliveryId, now)
}

export async function sendReservedReport(db: Db, api: Api, actor: Actor, id: string, fixedNow?: Date): Promise<ReportSent> {
  const clock = () => fixedNow ?? new Date()
  const row = await deliveries.findDelivery(db, actor.tenantId, id)
  if (!row || row.delivery.kind !== 'report') throw reportDeliveryUncertain()
  const delivery = row.delivery
  const message = delivery.message
  const progress = message.manualReport
  const receipt = (at: Date) => ({ destination: { id: delivery.destinationId, title: row.title }, sentAt: toIso(at) })
  if (delivery.sentAt) return receipt(delivery.sentAt)
  if (!progress) throw reportDeliveryUncertain()

  const checkClaim = (snapshot: deliveries.DeliveryRow) => reportClaimStatus(snapshot, clock()) === 'uncertain' ? reportDeliveryUncertain() : reportDeliveryInProgress()
  if (delivery.claimToken) throw checkClaim(delivery)
  const now = clock()
  if (progress.retryAt && progress.retryAt > now.getTime()) throw telegramRateLimited(Math.ceil((progress.retryAt - now.getTime()) / 1000))
  const destination = await destinations.findDestination(db, actor.tenantId, delivery.destinationId)
  if (!destination || destination.status === 'disconnected') throw destinationNotFound()
  if (destination.status !== 'connected') throw destinationBlocked(destination.title)
  const { chatId, title } = destination

  const active = { ...progress, checkBy: now.getTime() + CHECK_WINDOW_MS, retryAt: undefined }
  const token = await deliveries.claimManualReport(db, delivery, { ...message, manualReport: active })
  if (!token) {
    const current = await deliveries.findDelivery(db, actor.tenantId, id)
    if (current?.delivery.sentAt) return receipt(current.delivery.sentAt)
    throw current ? checkClaim(current.delivery) : reportDeliveryUncertain()
  }

  const settle = async (changes: Parameters<typeof deliveries.changeManualReportStatement>[3], after: Statement[] = []) => {
    try {
      if (await tryGuardedBatch(db, [deliveries.changeManualReportStatement(db, delivery, token, changes), requireOneChange(db), ...after])) return
    }
    catch {
      log('warn', 'Telegram report progress could not be recorded', { deliveryId: id })
    }
    throw reportDeliveryUncertain()
  }

  async function sendPart(part: Pick<StoredMessage, 'html' | 'document'>) {
    try {
      await sendStored(api, chatId, part)
    }
    catch (error) {
      const errorCode = error instanceof GrammyError ? error.error_code : undefined
      log('warn', 'Telegram report part could not be confirmed', { deliveryId: id, errorCode })
      // A definite rejection is safe to retry. Transport errors and 5xx may follow acceptance.
      if (!(error instanceof GrammyError) || error.error_code < 400 || error.error_code >= 500 || error.error_code === 408) {
        const uncertain = reportDeliveryUncertain()
        await settle({ lastError: uncertain.message, message: { ...message, manualReport: { ...active, checkBy: clock().getTime() } } })
        throw uncertain
      }
      const failure = sendFailure(error, title)
      const retryAt = error.error_code === 429 ? clock().getTime() + (error.parameters.retry_after ?? 30) * 1000 : undefined
      const lastError = active.textSent ? `The report text was sent. The CSV was refused. ${failure.message}` : failure.message
      await settle({ claimToken: null, lastError, message: { ...message, manualReport: { ...active, retryAt } } })
      if (isBlockedError(error)) await destinations.markBlocked(db, chatId, clock())
      if (active.textSent && failure.data) failure.data.message = lastError
      throw failure
    }
  }

  if (!active.textSent) {
    await sendPart({ html: message.html })
    if (message.document) {
      active.textSent = true
      // Never begin the file until the successful text send can be recovered on its own.
      await settle({ message: { ...message, manualReport: active } })
    }
  }
  if (message.document) await sendPart({ html: '', document: message.document })

  const sentAt = clock()
  const { manualReport: _, document, ...snapshot } = message
  await settle({
    status: 'sent', sentAt, claimToken: null, lastError: null,
    message: { ...snapshot, document: document && { filename: document.filename, content: '' } },
  }, [
    destinations.sentStatement(db, actor.tenantId, delivery.destinationId, sentAt),
    auditStatement(db, actor, { action: 'report.send', targetType: 'telegram_destination', targetId: delivery.destinationId, metadata: { ...progress.audit, deliveryId: id } }),
  ])
  return receipt(sentAt)
}
