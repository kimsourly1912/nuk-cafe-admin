import { getChannelLink } from '#server/features/marketing'

export default defineEventHandler(async (event) => {
  requireTelegram(event)
  const actor = await requirePermission(event, { settings: ['manage'] })
  return getChannelLink(useDb(), actor, readIdParam(event, 'id', 'This connect code'))
})
