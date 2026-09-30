import { confirmLink } from '~~/server/features/notifications'

/** Connects the group a link brought, after the admin confirmed it. */
export default defineEventHandler(async (event) => {
  requireTelegram(event)
  const actor = await requirePermission(event, { settings: ['manage'] })
  return confirmLink(useDb(), actor, readIdParam(event, 'id', 'This link'))
})
