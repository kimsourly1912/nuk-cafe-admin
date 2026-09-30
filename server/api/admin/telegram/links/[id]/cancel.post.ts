import { cancelLink } from '~~/server/features/notifications'

/** Ends a link; a group waiting for confirmation is not connected and the bot leaves it. */
export default defineEventHandler(async (event) => {
  const { api } = requireTelegram(event)
  const actor = await requirePermission(event, { settings: ['manage'] })
  return cancelLink(useDb(), api, actor, readIdParam(event, 'id', 'This link'))
})
