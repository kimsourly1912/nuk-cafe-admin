<script setup lang="ts">
/**
 * A promotion's posts to channels (M2a, D164), latest first: where, when, and how it went (Sent
 * with View post; Scheduled with Cancel; Sending or Retrying; Failed with the reason and Try
 * again; Cancelled). Post to channels opens the dialog while the promotion is live or scheduled.
 */
import type { BadgeProps } from '@nuxt/ui'
import type { MarketingPost } from '#shared/contracts/marketing'
import type { Promotion } from '#shared/contracts/menu-promotions'
import { usePostMutations, usePromotionPosts } from '../composables/usePromotionPosts'
import PostToChannelsModal from './PostToChannelsModal.vue'

const props = defineProps<{ promotion: Promotion }>()

const { data: posts, error, loading, refresh } = usePromotionPosts(props.promotion.id)
const { cancel, retry, isBusy } = usePostMutations()

const running = computed(() => props.promotion.phase === 'live' || props.promotion.phase === 'scheduled')
const postModal = useOverlay().create(PostToChannelsModal)
const post = () => postModal.open({ promotion: props.promotion })

function state(p: MarketingPost): { label: string, color: BadgeProps['color'], detail: string } {
  if (p.status === 'sent') return { label: 'Sent', color: 'success', detail: `Sent ${formatShortDateTime(p.sentAt ?? p.scheduledAt)}` }
  if (p.status === 'failed') return { label: 'Failed', color: 'error', detail: p.reason ?? 'Telegram didn\'t accept it.' }
  if (p.status === 'cancelled') return { label: 'Cancelled', color: 'neutral', detail: p.reason ?? 'Cancelled before it went out.' }
  if (p.attempts > 0) return { label: 'Retrying', color: 'warning', detail: p.reason ?? 'Sending…' }
  if (Date.parse(p.scheduledAt) > Date.now()) return { label: 'Scheduled', color: 'info', detail: `Goes out ${formatShortDateTime(p.scheduledAt)}` }
  return { label: 'Sending', color: 'warning', detail: 'Going out now' }
}
</script>

<template>
  <UCard
    as="section"
    variant="outline"
    aria-labelledby="promotion-posts"
    :ui="{ body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <h2
          id="promotion-posts"
          class="font-semibold text-highlighted"
        >
          Posts
        </h2>
        <UButton
          v-if="running"
          label="Post to channels"
          icon="i-lucide-send"
          size="sm"
          @click="post()"
        />
      </div>
    </template>

    <ApiErrorAlert
      v-if="error && !posts"
      :error="error"
      title="Could not load the posts"
      class="m-4"
      @retry="refresh()"
    />
    <ListSkeleton
      v-else-if="loading"
      label="Loading posts…"
      :count="1"
    />
    <p
      v-else-if="!posts?.length"
      class="p-4 text-sm text-muted sm:px-6"
    >
      {{ running ? 'Not posted yet. Post it to your Telegram channel: followers get the poster and an Order now button.' : 'It wasn\'t posted to any channel.' }}
    </p>
    <ul
      v-else
      class="divide-y divide-default"
    >
      <li
        v-for="p in posts"
        :key="p.id"
        class="flex items-start gap-3 p-4 sm:px-6"
        :class="isBusy(p.id) && 'opacity-50'"
      >
        <UIcon
          name="i-lucide-send"
          class="mt-0.5 size-5 shrink-0 text-muted"
        />
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium break-words text-highlighted">{{ p.channel.title }}</span>
            <UBadge
              :label="state(p).label"
              :color="state(p).color"
              variant="subtle"
            />
          </div>
          <p
            class="text-sm"
            :class="p.status === 'failed' ? 'text-error' : 'text-muted'"
          >
            {{ state(p).detail }}{{ p.createdBy ? ` · by ${p.createdBy}` : '' }}
          </p>
          <p class="line-clamp-1 text-sm text-muted">
            {{ p.withPoster ? 'Poster · ' : '' }}{{ p.caption }}
          </p>
        </div>
        <UIcon
          v-if="isBusy(p.id)"
          name="i-lucide-loader-circle"
          class="size-5 shrink-0 animate-spin text-muted"
          aria-label="Working…"
        />
        <template v-else>
          <UButton
            v-if="p.url"
            label="View post"
            icon="i-lucide-external-link"
            trailing
            color="neutral"
            variant="ghost"
            :to="p.url"
            target="_blank"
            external
            :aria-label="`View post in ${p.channel.title}`"
          />
          <UButton
            v-else-if="p.status === 'failed' && running"
            label="Try again"
            color="neutral"
            variant="outline"
            :aria-label="`Try again: ${p.channel.title}`"
            @click="retry.execute(p)"
          />
          <UButton
            v-else-if="p.status === 'pending' && p.attempts === 0 && Date.parse(p.scheduledAt) > Date.now()"
            label="Cancel"
            color="neutral"
            variant="outline"
            :aria-label="`Cancel the post to ${p.channel.title}`"
            @click="cancel.execute(p)"
          />
        </template>
      </li>
    </ul>
  </UCard>
</template>
