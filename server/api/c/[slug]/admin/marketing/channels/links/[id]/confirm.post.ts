import { confirmChannelLink } from '#server/features/marketing'

/** The channel the code was posted in is the cafe's: connect it. */
export default defineEventHandler(async (event) => {
  requireTelegram(event)
  const actor = await requirePermission(event, { settings: ['manage'] })
  return confirmChannelLink(useDb(), actor, readIdParam(event, 'id', 'This connect code'))
})
