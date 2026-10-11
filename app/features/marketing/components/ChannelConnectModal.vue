<script setup lang="ts">
/**
 * Connect a Telegram channel (M2a, D164). Telegram's "add to a channel" link carries nothing back,
 * so the channel is found by a one-time code: (1) add the bot to the channel as an admin that can
 * post, (2) post `/connect CODE` there, (3) the bot reads it, deletes it and this dialog shows the
 * channel to confirm. The dialog asks every 2 seconds how it went. Closing while a channel waits
 * cancels it (the bot leaves that channel).
 */
import { useClipboard, useIntervalFn } from '@vueuse/core'
import type { ChannelLink, NewChannelLink } from '#shared/contracts/marketing'
import { CHANNEL_LINK_MINUTES } from '#shared/contracts/marketing'
import { fetchChannelLink, useChannelMutations } from '../composables/useChannelMutations'

const emit = defineEmits<{ close: [connected: boolean] }>()

const { createLink, confirmLink, cancelLink } = useChannelMutations()
const { isCompact } = useLayoutContext()
const { copy, copied } = useClipboard({ legacy: true })

const link = ref<NewChannelLink>()
const status = ref<ChannelLink['status']>('waiting')
const channel = ref<ChannelLink['channel']>(null)

async function start() {
  status.value = 'waiting'
  channel.value = null
  link.value = undefined
  const result = await createLink.execute(undefined)
  if (result.ok) link.value = result.data
}
start()

const progress = useApiQuery(
  () => `marketing:link:${link.value?.id ?? ''}`,
  async () => (link.value ? fetchChannelLink(link.value.id) : null),
)
const polling = useIntervalFn(() => {
  if (link.value && status.value === 'waiting' && !progress.pending.value) progress.refresh()
}, 2000)

watch(() => progress.data.value, (now) => {
  if (!now || now.id !== link.value?.id || now.status === status.value) return
  status.value = now.status
  channel.value = now.channel
})

async function confirm() {
  if (!link.value) return
  const result = await confirmLink.execute({ id: link.value.id })
  if (result.ok) {
    polling.pause()
    emit('close', true)
  }
  else if (result.status === 'error') status.value = 'expired'
}

async function close() {
  polling.pause()
  // A channel waiting for confirmation: not connected, and the bot leaves it.
  if (link.value && status.value === 'confirm') await cancelLink.execute({ id: link.value.id })
  emit('close', false)
}

const subscribers = (count: number | null) => (count === null ? '' : `${count.toLocaleString('en-US')} ${count === 1 ? 'subscriber' : 'subscribers'}`)
</script>

<template>
  <UModal
    title="Connect a Telegram channel"
    :fullscreen="isCompact"
    :dismissible="false"
    :ui="{ body: 'space-y-5' }"
    @update:open="(open: boolean) => { if (!open) close() }"
  >
    <template #body>
      <template v-if="status === 'confirm' && channel">
        <div class="flex items-center gap-3 rounded-lg border border-default p-4">
          <UIcon
            name="i-lucide-megaphone"
            class="size-6 shrink-0 text-primary"
          />
          <div class="min-w-0">
            <p class="font-semibold break-words text-highlighted">
              {{ channel.title }}
            </p>
            <p class="text-sm text-muted">
              {{ [channel.username ? `@${channel.username}` : 'Private channel', subscribers(channel.subscriberCount)].filter(Boolean).join(' · ') }}
            </p>
          </div>
        </div>
        <p class="text-sm text-muted">
          Promotions you post go to everyone who follows this channel. The code you posted was deleted from it.
        </p>
      </template>

      <UAlert
        v-else-if="status === 'expired' || status === 'cancelled'"
        color="neutral"
        variant="subtle"
        icon="i-lucide-clock"
        title="This code doesn't work anymore."
        description="Make a new one and post it in the channel."
      />

      <template v-else>
        <ol class="space-y-5">
          <li class="flex gap-3">
            <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-elevated text-sm font-semibold text-highlighted">1</span>
            <div class="min-w-0 flex-1 space-y-2">
              <p class="pt-0.5">
                Add <strong>@{{ link?.botUsername ?? '…' }}</strong> to your channel as an admin that can post messages.
              </p>
              <UButton
                v-if="link"
                :to="link.addBotUrl"
                target="_blank"
                external
                label="Open Telegram"
                icon="i-lucide-send"
                color="neutral"
                variant="outline"
              />
              <p class="text-xs text-muted">
                Choose your channel, then keep "Post messages" and "Delete messages" on.
              </p>
            </div>
          </li>
          <li class="flex gap-3">
            <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-elevated text-sm font-semibold text-highlighted">2</span>
            <div class="min-w-0 flex-1 space-y-2">
              <p class="pt-0.5">
                Post this message in the channel:
              </p>
              <div
                v-if="link"
                class="flex items-center gap-2"
              >
                <code
                  class="min-w-0 flex-1 truncate rounded-md bg-elevated px-3 py-2 font-mono text-highlighted"
                  data-testid="connect-command"
                >{{ link.command }}</code>
                <UButton
                  :label="copied ? 'Copied' : 'Copy'"
                  :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                  color="neutral"
                  variant="outline"
                  @click="copy(link.command)"
                />
              </div>
              <USkeleton
                v-else
                class="h-10 w-full"
              />
              <p class="text-xs text-muted">
                The bot reads it and deletes it at once: your followers won't see it for long.
              </p>
            </div>
          </li>
        </ol>
        <div
          class="flex items-center gap-3 rounded-md border border-default p-3"
          role="status"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-5 shrink-0 animate-spin text-muted"
          />
          <div>
            <p class="font-medium text-highlighted">
              Waiting for the code in your channel…
            </p>
            <p class="text-sm text-muted">
              It works for {{ CHANNEL_LINK_MINUTES }} minutes, once. Nothing happening? Check the bot is an admin that can post.
            </p>
          </div>
        </div>
      </template>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          :loading="cancelLink.pending"
          @click="close()"
        />
        <UButton
          v-if="status === 'confirm'"
          label="Connect channel"
          icon="i-lucide-check"
          :loading="confirmLink.pending"
          @click="confirm()"
        />
        <UButton
          v-else-if="status === 'expired' || status === 'cancelled'"
          label="New code"
          icon="i-lucide-refresh-cw"
          :loading="createLink.pending"
          @click="start()"
        />
      </div>
    </template>
  </UModal>
</template>
