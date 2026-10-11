import { cancelChannelLink } from '#server/features/marketing'

/** Not that channel: the code ends and the bot leaves it. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { settings: ['manage'] })
  const { api } = requireTelegram(event)
  return cancelChannelLink(useDb(), api, actor, readIdParam(event, 'id', 'This connect code'))
})
