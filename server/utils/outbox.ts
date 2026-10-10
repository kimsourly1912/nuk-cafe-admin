import type { H3Event } from 'h3'
import { accountMailHandlers, activeTenants, consoleSender, resendSender } from '#server/features/identity'
import type { MailSender } from '#server/features/identity'
import { deliverDue, queueOrderAlert } from '#server/features/notifications'
import { ORDER_EVENTS } from '#server/features/orders'
import { deliverOutbox } from '#server/features/platform'
import type { OutboxHandler } from '#server/features/platform'
import { log } from '#server/utils/log'

/**
 * Resend when a key is set. Without one, the dev server prints mail to the console; anything else
 * throws, so the messages stay queued (and are logged as failing) rather than put one-time links
 * into production logs.
 */
function mailSender(): MailSender {
  const { mail } = useRuntimeConfig()
  if (mail.resendApiKey) {
    if (!mail.from) throw new Error('Set NUXT_MAIL_FROM ("NUK Cafe <no-reply@…>") to send mail.')
    return resendSender({ apiKey: mail.resendApiKey, from: mail.from })
  }
  if (import.meta.dev) return consoleSender()
  throw new Error('Set NUXT_MAIL_RESEND_API_KEY to send mail.')
}

/**
 * The Telegram alerts for an order event (D113), to the chats of the order's tenant (the message's,
 * D138): saved as deliveries, then sent at once (what fails is retried by `notifications:deliver`).
 * Without a bot there's nothing to do, and the event is done.
 */
async function orderAlert(tenantId: string | null, kind: 'new_order' | 'payment', orderId: unknown) {
  const settings = useTelegram()
  if (!settings || !tenantId || typeof orderId !== 'string') return
  const db = useDb()
  // "Open order" opens the order's own cafe's counter (`/c/<slug>/counter/…`, D141).
  const tenant = (await activeTenants(db)).find(t => t.id === tenantId)
  const ids = await queueOrderAlert(db, tenantId, kind, orderId, tenant ? cafeSiteUrl(tenant.slug) : undefined)
  await deliverDue(db, telegramApi(settings), new Date(), { ids })
}

/**
 * One handler per outbox message kind, from the feature that owns it. A message whose kind has no
 * handler is retried, then marked `failed`, so a missing handler shows up in the logs instead of
 * losing messages silently. Used by `platform:deliver-outbox` and by `sendOrderEventsNow`.
 */
export function outboxHandlers(): Record<string, OutboxHandler> {
  const send: MailSender = (message, key) => mailSender()(message, key)
  return {
    ...accountMailHandlers(send),
    [ORDER_EVENTS.placed]: message => orderAlert(message.tenantId, 'new_order', message.payload.orderId),
    [ORDER_EVENTS.paid]: message => orderAlert(message.tenantId, 'payment', message.payload.orderId),
  }
}

/**
 * Sends the order events this request just wrote (an order placed, a payment recorded) right after
 * the answer, so the Telegram alert arrives within seconds instead of at the next minute's
 * `platform:deliver-outbox` (D150). The work runs after the response (`waitUntil`); each message is
 * claimed first, so the scheduled run never sends it twice, and anything that fails here is retried
 * by that run. Never fails the request.
 */
export function sendOrderEventsNow(event: H3Event) {
  const work = deliverOutbox(useDb(), outboxHandlers(), { kinds: [ORDER_EVENTS.placed, ORDER_EVENTS.paid] })
    .then((report) => {
      for (const failure of report.failures) log('warn', 'Order event will be retried by the scheduled run', failure, event)
    })
    .catch(error => log('warn', 'Could not send order events now; the scheduled run will', { error: error instanceof Error ? error.message : String(error) }, event))
  event.waitUntil(work)
}
