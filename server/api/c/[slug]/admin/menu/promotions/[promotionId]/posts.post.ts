import { createPostsSchema } from '#shared/contracts/marketing'
import { createPosts, deliverDuePosts, listPosts } from '#server/features/marketing'

/**
 * `{ channelIds, caption, withPoster, at }` with an `Idempotency-Key`: posts the promotion to each
 * channel. Without `at` they go out now, in this request, and the answer says how each went;
 * with `at`, the scheduled task sends them then (M2a, D164).
 */
export default defineEventHandler(async (event) => {
  const { api } = requireTelegram(event)
  const actor = await requirePermission(event, { menu: ['write'] })
  const promotionId = readIdParam(event, 'promotionId', 'This promotion')
  const key = readIdempotencyKey(event)
  const input = await readValidBody(event, createPostsSchema)
  const db = useDb()
  const posts = await createPosts(db, actor, promotionId, input, key, requestCafeUrl(event))
  setResponseStatus(event, 201)
  if (input.at) return posts
  await deliverDuePosts(db, api, readStoredObject, new Date(), { ids: posts.map(post => post.id) })
  const ids = new Set(posts.map(post => post.id))
  return (await listPosts(db, actor.tenantId, promotionId)).filter(post => ids.has(post.id))
})
