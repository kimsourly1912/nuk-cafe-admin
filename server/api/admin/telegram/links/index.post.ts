import { createTelegramLinkSchema } from '#shared/contracts/notifications'
import { createLink } from '~~/server/features/notifications'

/** `{ kind }`: a one-time link to connect a private chat or a group (10 minutes, D112). */
export default defineEventHandler(async (event) => {
  const { settings } = requireTelegram(event)
  const actor = await requirePermission(event, { settings: ['manage'] })
  return createLink(useDb(), actor, settings, await readValidBody(event, createTelegramLinkSchema))
})
