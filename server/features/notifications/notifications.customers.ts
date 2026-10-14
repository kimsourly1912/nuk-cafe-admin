import type { Api } from 'grammy'
import type { Message } from 'grammy/types'
import type { OrderReadyAlert, OrderReadyAlertStatus, OrderReadyLink } from '#shared/contracts/notifications'
import { ORDER_READY_LINK_MINUTES } from '#shared/contracts/notifications'
import type { OrderStatus } from '#shared/contracts/orders'
import { activeTenants } from '#server/features/identity'
import { orderAlert } from '#server/features/orders'
import type { Db } from '#server/utils/batch'
import { isStaleWrite, requireOneChange } from '#server/utils/batch'
import { log } from '#server/utils/log'
import { maintenanceLimit } from '#server/utils/maintenance'
import { orderReadyAlertTooLate } from './notifications.errors'
import { orderReadyMessage, orderReadySubscribedText } from './notifications.messages'
import * as repo from './notifications.repository'
import { sendStored } from './notifications.delivery'
import { hashLinkCode, isBlockedError, newLinkCode } from './notifications.rules'
import type { TelegramSettings } from './notifications.settings'

/**
 * "Your order is ready" on Telegram, for customers (D157). From their order page a customer asks
 * for a one-time link to the bot (`t.me/<bot>?start=o_<code>`); pressing Start in Telegram ties
 * that private chat to the order; when the counter marks it ready (`orders.ready`), the chat gets
 * one message. Works the same for guests and accounts: the order page is the customer's own (the
 * routes check that). One chat per order, no account linked to Telegram, and the chat id is
 * forgotten once the message was sent.
 */

const MINUTE = 60_000

/** Starts every customer's code, so the webhook tells them from the staff's connect links. */
export const ORDER_CODE_PREFIX = 'o_'

/** The order can still become ready: asking makes sense. */
const WAITING_FOR_READY: OrderStatus[] = ['awaiting_payment', 'preparing']

function statusOf(row: repo.OrderReadyAlertRow | undefined, now: Date): OrderReadyAlertStatus {
  if (!row) return 'off'
  if (row.notifiedAt) return 'sent'
  if (row.chatId) return 'on'
  return row.codeHash && row.linkExpiresAt > now ? 'waiting' : 'off'
}

/** Whether the order's customer asked to be told, for their order page. The caller checked the order is theirs. */
export async function orderReadyAlert(db: Db, tenantId: string, orderId: string, settings: TelegramSettings | null, now = new Date()): Promise<OrderReadyAlert> {
  if (!settings) return { available: false, status: 'off' }
  return { available: true, status: statusOf(await repo.findOrderReadyAlert(db, tenantId, orderId), now) }
}

/**
 * A new one-time link for the order (the code is only in this answer; the database keeps its
 * hash). Asking again makes a new code: the old one stops working. The caller checked the order is
 * the customer's own.
 */
export async function createOrderReadyLink(db: Db, tenantId: string, order: { id: string, status: OrderStatus }, settings: TelegramSettings, now = new Date()): Promise<OrderReadyLink> {
  if (!WAITING_FOR_READY.includes(order.status)) throw orderReadyAlertTooLate()
  const code = `${ORDER_CODE_PREFIX}${newLinkCode()}`
  await repo.saveOrderReadyLink(db, { tenantId, orderId: order.id, codeHash: await hashLinkCode(code), linkExpiresAt: new Date(now.getTime() + ORDER_READY_LINK_MINUTES * MINUTE), createdAt: now })
  const after = await repo.findOrderReadyAlert(db, tenantId, order.id)
  return { available: true, status: statusOf(after, now), url: `https://t.me/${settings.botUsername}?start=${code}` }
}

async function reply(api: Api, chatId: number | string, text: string) {
  try {
    await api.sendMessage(chatId, text)
  }
  catch (error) {
    log('warn', 'Telegram: could not reply to a customer', { error: String(error) })
  }
}

const EXPIRED_REPLY = 'This link doesn\'t work anymore. Open your order on the cafe\'s website and tap Message me on Telegram again.'

/**
 * `/start o_<code>` from the webhook. Returns `false` when no order has that code (a staff link
 * whose random code happens to start like ours): the caller then tries the staff links.
 */
export async function useOrderReadyCode(db: Db, api: Api, message: Message, code: string, now = new Date()): Promise<boolean> {
  const row = await repo.findOrderReadyAlertByCode(db, await hashLinkCode(code))
  if (!row) return false
  const chat = message.chat
  if (chat.type !== 'private') {
    await reply(api, chat.id, 'Open this link in your own chat with the bot, not in a group.')
    return true
  }
  const [alert, tenants] = await Promise.all([orderAlert(db, row.tenantId, row.orderId), activeTenants(db)])
  const cafeName = tenants.find(t => t.id === row.tenantId)?.name
  if (!alert || !cafeName || row.linkExpiresAt <= now) {
    await reply(api, chat.id, EXPIRED_REPLY)
    return true
  }
  // Too late to wait for "ready": say so instead of promising a message that won't come.
  if (!WAITING_FOR_READY.includes(alert.status)) {
    await reply(api, chat.id, alert.status === 'ready' ? `Order ${String(alert.pickupNumber).padStart(3, '0')} is ready now: collect it at the counter.` : 'This order isn\'t being prepared any more.')
    return true
  }
  // Single use: only the code this row holds, unexpired. Telegram resending the update finds nothing.
  try {
    await db.batch([repo.subscribeOrderReadyAlertStatement(db, row.orderId, row.codeHash!, String(chat.id), now), requireOneChange(db)])
  }
  catch (error) {
    if (isStaleWrite(error)) return true
    throw error
  }
  await reply(api, chat.id, orderReadySubscribedText(cafeName, alert.pickupNumber))
  // Marked ready while this chat was signing up: its event found no chat, so send it now.
  if ((await orderAlert(db, row.tenantId, row.orderId))?.status === 'ready') await sendOrderReadyAlert(db, api, row.tenantId, row.orderId, undefined, now)
  return true
}

/**
 * The `orders.ready` event: the message to the chat that asked, once. Telegram's refusal for a
 * blocked bot gives up (the chat is forgotten); anything else throws, so the outbox retries. A
 * retry after a lost answer can repeat the message (Telegram has no idempotency key), like the
 * staff alerts (D113).
 */
export async function sendOrderReadyAlert(db: Db, api: Api, tenantId: string, orderId: string, cafeUrl?: string, now = new Date()): Promise<boolean> {
  const row = await repo.findOrderReadyAlert(db, tenantId, orderId)
  if (!row?.chatId || row.notifiedAt) return false
  const [alert, tenants] = await Promise.all([orderAlert(db, tenantId, orderId), activeTenants(db)])
  const cafeName = tenants.find(t => t.id === tenantId)?.name
  if (!alert || !cafeName || alert.status !== 'ready') {
    // Completed or cancelled before the event was handled: nothing to say any more.
    await repo.markOrderReadyNotified(db, tenantId, orderId, row.chatId, now)
    return false
  }
  try {
    await sendStored(api, row.chatId, orderReadyMessage(cafeName, alert, cafeUrl))
  }
  catch (error) {
    if (!isBlockedError(error)) throw error
    log('info', 'Telegram: a customer blocked the bot before their order was ready', { orderId })
    await repo.markOrderReadyNotified(db, tenantId, orderId, row.chatId, now)
    return false
  }
  await repo.markOrderReadyNotified(db, tenantId, orderId, row.chatId, now)
  return true
}

/** Kept 2 days: the order is long finished by then. */
export async function purgeOrderReadyAlerts(db: Db, now = new Date(), limit = 500): Promise<number> {
  return repo.deleteOrderReadyAlertsBefore(db, new Date(now.getTime() - 2 * 24 * 60 * MINUTE), maintenanceLimit(limit))
}
