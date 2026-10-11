import { channelVersionSchema } from '#shared/contracts/marketing'
import { disconnectChannel } from '#server/features/marketing'

/** `{ version }`: nothing more is posted there; the bot leaves the channel. Its posts stay. */
export default defineEventHandler(async (event) => {
  const { api } = requireTelegram(event)
  const actor = await requirePermission(event, { settings: ['manage'] })
  const id = readIdParam(event, 'channelId', 'This channel')
  const { version } = await readValidBody(event, channelVersionSchema)
  await disconnectChannel(useDb(), api, actor, id, version)
  setResponseStatus(event, 204)
  return null
})
