import { setNotificationRuleSchema } from '#shared/contracts/notifications'
import { setNotificationRule } from '~~/server/features/notifications'

/** `{ kind, destinationId, enabled, attachCsv }`: one notification on or off for one chat (D113). */
export default defineEventHandler(async (event) => {
  requireTelegram(event)
  const actor = await requirePermission(event, { settings: ['manage'] })
  return setNotificationRule(useDb(), actor, await readValidBody(event, setNotificationRuleSchema))
})
