import type { H3Event } from 'h3'
import { accountIdentities, tenantById } from '#server/features/identity'
import { deliverDue, queueSupportOpenedAlert } from '#server/features/notifications'
import { log } from '#server/utils/log'

/**
 * Tells the cafe's Telegram chats that get operational alerts that platform support was opened
 * (D193), right after the answer (`waitUntil`). Nothing to do without a bot or a chat; a failure
 * is logged and never fails the visit: the banner and the history are the owner's record.
 */
export function alertSupportOpened(event: H3Event, tenantId: string, visit: { visitId: string, userId: string, expiresAt: string }) {
  const settings = useTelegram(event)
  if (!settings) return
  const work = (async () => {
    const db = useDb()
    const tenant = await tenantById(db, tenantId)
    const name = (await accountIdentities(db, [visit.userId])).get(visit.userId)?.name ?? null
    const ids = await queueSupportOpenedAlert(db, tenantId, visit.visitId, { name, expiresAt: new Date(visit.expiresAt) }, tenant ? cafeSiteUrl(tenant.slug) : undefined)
    await deliverDue(db, telegramApi(settings), undefined, { ids, budgetMs: 5000 })
  })().catch(error => log('warn', 'Could not tell the cafe that support was opened', { error: error instanceof Error ? error.message : String(error) }, event))
  event.waitUntil(work)
}
