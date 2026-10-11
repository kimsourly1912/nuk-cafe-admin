import { postVersionSchema } from '#shared/contracts/marketing'
import { deliverDuePosts, listPosts, retryPost } from '#server/features/marketing'

/** `{ version }`: a failed post goes out again now; the answer is how that went. */
export default defineEventHandler(async (event) => {
  const { api } = requireTelegram(event)
  const actor = await requirePermission(event, { menu: ['write'] })
  const db = useDb()
  const post = await retryPost(db, actor, readIdParam(event, 'postId', 'This post'), await readValidBody(event, postVersionSchema))
  await deliverDuePosts(db, api, readStoredObject, new Date(), { ids: [post.id] })
  return (await listPosts(db, actor.tenantId, post.promotionId)).find(p => p.id === post.id)!
})
