<script setup lang="ts">
/**
 * "Message me on Telegram when it's ready" on the customer's order page (D157): a one-time link to
 * the cafe's bot; tapping Start there ties the chat to this order, and the counter's Mark ready
 * sends one message. Two taps on purpose (make the link, then open it): a browser blocks a window
 * opened after waiting for the server, and a real link lets a phone open the Telegram app.
 * Nothing shows on a server without a bot.
 */
import type { Order } from '#shared/contracts/orders'
import { useOrderReadyAlert } from '../composables/useOrders'

const props = defineProps<{ order: Pick<Order, 'id' | 'status'> }>()

const { query, createLink } = useOrderReadyAlert(() => props.order.id)
const alert = computed(() => query.data.value)
/** The link just made: only in the answer that made it (the server keeps its hash). */
const url = ref<string | null>(null)
const canAsk = computed(() => props.order.status === 'awaiting_payment' || props.order.status === 'preparing')

async function ask() {
  const result = await createLink.execute(props.order.id)
  if (!result.ok) return
  url.value = result.data.url
  query.data.value = { available: result.data.available, status: result.data.status }
}

// The chat is tied (or the link expired): the link has done its job.
watch(() => alert.value?.status, (status) => {
  if (status !== 'waiting') url.value = null
})
</script>

<template>
  <div
    v-if="alert?.available && (canAsk || alert.status === 'on' || alert.status === 'sent')"
    class="rounded-md border border-default p-3"
    aria-label="Telegram message"
    role="group"
  >
    <div
      v-if="alert.status === 'on'"
      class="flex items-center gap-3"
      role="status"
    >
      <UIcon
        name="i-lucide-circle-check"
        class="size-5 shrink-0 text-success"
      />
      <p class="text-sm text-highlighted">
        We'll message you on Telegram when it's ready.
      </p>
    </div>

    <div
      v-else-if="alert.status === 'sent'"
      class="flex items-center gap-3"
    >
      <UIcon
        name="i-lucide-send"
        class="size-5 shrink-0 text-muted"
      />
      <p class="text-sm text-muted">
        Sent to your Telegram.
      </p>
    </div>

    <div
      v-else-if="url"
      class="space-y-3"
    >
      <div class="flex items-start gap-3">
        <UIcon
          name="i-lucide-send"
          class="mt-0.5 size-5 shrink-0 text-primary"
        />
        <div class="space-y-0.5">
          <p class="text-sm font-medium text-highlighted">
            Open Telegram, then tap Start
          </p>
          <p class="text-sm text-muted">
            This link works once, for 15 minutes.
          </p>
        </div>
      </div>
      <UButton
        :to="url"
        target="_blank"
        external
        label="Open Telegram"
        icon="i-lucide-send"
        block
      />
    </div>

    <div
      v-else
      class="flex flex-wrap items-center gap-3"
    >
      <UIcon
        name="i-lucide-bell"
        class="size-5 shrink-0 text-muted"
      />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-highlighted">
          Get a message when it's ready
        </p>
        <p class="text-sm text-muted">
          On Telegram, from the cafe's bot.
        </p>
      </div>
      <UButton
        label="Message me on Telegram"
        color="neutral"
        variant="outline"
        :loading="createLink.isPending(order.id)"
        class="max-sm:w-full max-sm:justify-center"
        @click="ask"
      />
    </div>
  </div>
</template>
