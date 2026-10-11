import { postVersionSchema } from '#shared/contracts/marketing'
import { cancelPost } from '#server/features/marketing'

/** `{ version }`: a scheduled post won't go out. */
export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })
  return cancelPost(useDb(), actor, readIdParam(event, 'postId', 'This post'), await readValidBody(event, postVersionSchema))
})
