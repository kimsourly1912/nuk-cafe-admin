import { destinationVersionSchema } from '#shared/contracts/notifications'
import { disconnectDestination } from '#server/features/notifications'

/** `{ version }`: stops sending to a chat (the bot leaves a group). */
export default defineEventHandler(async (event) => {
  const { api } = requireTelegram(event)
  const actor = await requirePermission(event, { settings: ['manage'] })
  const id = readIdParam(event, 'id', 'This Telegram chat')
  const { version } = await readValidBody(event, destinationVersionSchema)
  await disconnectDestination(useDb(), api, actor, id, version)
  setResponseStatus(event, 204)
  return null
})
