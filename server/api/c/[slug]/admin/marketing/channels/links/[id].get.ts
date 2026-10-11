import { getChannelLink } from '#server/features/marketing'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { settings: ['manage'] })
  requireTelegram(event)
  return getChannelLink(useDb(), actor, readIdParam(event, 'id', 'This connect code'))
})
