import { createChannelLink } from '#server/features/marketing'

/** A one-time `/connect` code to post in the channel (15 minutes, D164). */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { settings: ['manage'] })
  const { settings, api } = requireTelegram(event)
  return createChannelLink(useDb(), api, actor, settings)
})
