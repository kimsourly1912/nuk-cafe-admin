import type { CreatePostsInput, MarketingPost } from '#shared/contracts/marketing'

/** A promotion's posts to channels (M2a, D164), latest first. */
export function usePromotionPosts(promotionId: string) {
  return useApiQuery(`promotions:posts:${promotionId}`, () => apiFetch<MarketingPost[]>(`/admin/menu/promotions/${promotionId}/posts`))
}

function sentText(posts: MarketingPost[]): string {
  const sent = posts.filter(p => p.status === 'sent').length
  if (sent === posts.length) return sent === 1 ? `Posted to ${posts[0]!.channel.title}` : `Posted to ${sent} channels`
  if (posts.every(p => p.status === 'pending' && p.attempts === 0)) return posts.length === 1 ? `Post scheduled for ${posts[0]!.channel.title}` : `${posts.length} posts scheduled`
  return `${sent} of ${posts.length} posted. See Posts for the others.`
}

/**
 * Posting and the posts' actions. Posting sends one `Idempotency-Key` per submission (the dialog
 * makes it), so a retry after a lost answer never posts twice.
 */
export function usePostMutations() {
  const create = useMutation(
    ({ promotionId, body, key }: { promotionId: string, body: CreatePostsInput, key: string }) =>
      apiFetch<MarketingPost[]>(`/admin/menu/promotions/${promotionId}/posts`, { method: 'POST', body, headers: { 'Idempotency-Key': key } }),
    {
      id: 'promotions:post',
      key: ({ promotionId }) => `posts:${promotionId}`,
      successMessage: posts => sentText(posts),
      errorMessage: 'Could not post',
      invalidate: ['promotions'],
    },
  )
  const cancel = useMutation(
    (post: MarketingPost) => apiFetch<MarketingPost>(`/admin/marketing/posts/${post.id}/cancel`, { method: 'POST', body: { version: post.version } }),
    {
      id: 'promotions:post-cancel',
      key: p => p.id,
      lock: p => `post:${p.id}`,
      confirm: p => ({ title: `Cancel the post to ${p.channel.title}?`, description: 'It won\'t go out. You can post again any time.', confirmLabel: 'Cancel post', cancelLabel: 'Keep it', danger: true }),
      successMessage: (_, p) => `Post to ${p.channel.title} cancelled`,
      errorMessage: p => `Could not cancel the post to ${p.channel.title}`,
      invalidate: ['promotions'],
    },
  )
  const retry = useMutation(
    (post: MarketingPost) => apiFetch<MarketingPost>(`/admin/marketing/posts/${post.id}/retry`, { method: 'POST', body: { version: post.version } }),
    {
      id: 'promotions:post-retry',
      key: p => p.id,
      lock: p => `post:${p.id}`,
      successMessage: (after, p) => (after.status === 'sent' ? `Posted to ${p.channel.title}` : `The post to ${p.channel.title} will be tried again`),
      errorMessage: p => `Could not post to ${p.channel.title}`,
      invalidate: ['promotions'],
    },
  )
  return { create, cancel, retry, isBusy: (id: string) => cancel.isPending(id) || retry.isPending(id) }
}
