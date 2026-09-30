<script setup lang="ts">
/**
 * Connect a chat (step 8.1c, D112, the owner's frames): a one-time link opened in Telegram, then
 * "Waiting for Telegram…" while the portal asks every 2 seconds how it went. A private chat is
 * connected as soon as the admin presses Start there; a group comes back as "Connect <name>?" and
 * is connected only when the admin confirms it here. Closing while a group waits cancels it (the
 * bot leaves that group).
 */
import { useIntervalFn } from '@vueuse/core'
import type { DestinationKind, NewTelegramLink, TelegramLink } from '#shared/contracts/notifications'
import { TELEGRAM_LINK_MINUTES } from '#shared/contracts/notifications'
import { fetchLink, useTelegramMutations } from '../composables/useTelegram'

const props = defineProps<{ kind: DestinationKind, botUsername: string }>()
const emit = defineEmits<{ close: [connected: boolean] }>()

const { createLink, confirmLink, cancelLink } = useTelegramMutations()
const { isCompact } = useLayoutContext()
const notify = useNotify()

const link = ref<NewTelegramLink>()
const status = ref<TelegramLink['status']>('waiting')
const chat = ref<TelegramLink['chat']>(null)

async function start() {
  status.value = 'waiting'
  chat.value = null
  const result = await createLink.execute({ kind: props.kind })
  if (result.ok) link.value = result.data
}
start()

// While the link is live, ask how it went (the webhook updates it on the server).
const progress = useApiQuery(
  () => `telegram:link:${link.value?.id ?? ''}`,
  async () => (link.value ? fetchLink(link.value.id) : null),
)
const live = () => status.value === 'waiting' || status.value === 'confirm'
const polling = useIntervalFn(() => {
  if (link.value && live() && !progress.pending.value) progress.refresh()
}, 2000)

watch(() => progress.data.value, (now) => {
  // Every answer is a new object: act only on a change of status.
  if (!now || now.id !== link.value?.id || now.status === status.value) return
  status.value = now.status
  chat.value = now.chat
  if (now.status === 'connected') {
    polling.pause()
    invalidate('telegram', 'reports')
    notify.success(`${now.chat?.title ?? 'The chat'} is connected`)
    emit('close', true)
  }
})

async function confirm() {
  if (!link.value) return
  const result = await confirmLink.execute({ id: link.value.id })
  if (result.ok) {
    polling.pause()
    emit('close', true)
  }
}

async function close() {
  polling.pause()
  // A group waiting for confirmation: not connected, and the bot leaves it.
  if (link.value && status.value === 'confirm') await cancelLink.execute({ id: link.value.id })
  emit('close', false)
}

const title = computed(() => (props.kind === 'group' ? 'Connect a staff group' : 'Connect your Telegram'))
const steps = computed(() => props.kind === 'group'
  ? ['Open Telegram with the button below and choose your staff group.', `Telegram asks to add @${props.botUsername} to the group: accept.`, 'Come back here to confirm the group.']
  : ['Open Telegram with the button below.', `Press Start in the chat with @${props.botUsername}.`, 'Come back here: it connects by itself.'])
</script>

<template>
  <UModal
    :title="title"
    :fullscreen="isCompact"
    :dismissible="false"
    :ui="{ body: 'space-y-5' }"
    @update:open="(open: boolean) => { if (!open) close() }"
  >
    <template #body>
      <template v-if="status === 'confirm' && chat">
        <p class="text-highlighted">
          Connect <strong>{{ chat.title }}</strong>{{ ' ' }}<span class="text-muted">(group{{ chat.memberCount ? `, ${chat.memberCount} members` : '' }})</span>?
        </p>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-users"
          title="Everyone in this group sees what's sent there."
          description="Order details and, if you choose, reports. Connect only your staff group."
        />
      </template>

      <template v-else-if="status === 'expired' || status === 'cancelled'">
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-clock"
          title="This link doesn't work anymore."
          description="Make a new one and open it in Telegram."
        />
      </template>

      <template v-else>
        <ol class="space-y-3">
          <li
            v-for="(step, index) in steps"
            :key="index"
            class="flex gap-3"
          >
            <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-elevated text-sm font-semibold text-highlighted">{{ index + 1 }}</span>
            <span class="pt-0.5">{{ step }}</span>
          </li>
        </ol>
        <UButton
          v-if="link"
          :to="link.url"
          target="_blank"
          external
          label="Open in Telegram"
          icon="i-lucide-send"
          size="lg"
          block
        />
        <USkeleton
          v-else
          class="h-11 w-full"
        />
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
              Waiting for Telegram…
            </p>
            <p class="text-sm text-muted">
              This link works for {{ TELEGRAM_LINK_MINUTES }} minutes, once.
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
          label="Connect"
          icon="i-lucide-check"
          :loading="confirmLink.pending"
          @click="confirm()"
        />
        <UButton
          v-else-if="status === 'expired' || status === 'cancelled'"
          label="New link"
          icon="i-lucide-refresh-cw"
          :loading="createLink.pending"
          @click="start()"
        />
      </div>
    </template>
  </UModal>
</template>
