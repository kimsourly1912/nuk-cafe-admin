import { createChannelLink } from '#server/features/marketing'

/** A one-time `/connect` code to post in the channel (15 minutes, D164). */
export default defineEventHandler(async (event) => {
  const { settings, api } = requireTelegram(event)
  const actor = await requirePermission(event, { settings: ['manage'] })
  return createChannelLink(useDb(), api, actor, settings)
})
