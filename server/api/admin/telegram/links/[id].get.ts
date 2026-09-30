import { getLink } from '~~/server/features/notifications'

/** A link's progress (waiting, confirm, connected…), for the admin who made it. */
export default defineEventHandler(async (event) => {
  requireTelegram(event)
  const actor = await requirePermission(event, { settings: ['manage'] })
  return getLink(useDb(), actor, readIdParam(event, 'id', 'This link'))
})
