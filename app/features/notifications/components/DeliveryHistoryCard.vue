<script setup lang="ts">
/**
 * The delivery history (step 8.1d, D113, the owner's frames): the latest 50 messages to Telegram,
 * newest first, with what, to whom and how it went. "Retrying at 9:05" while it's still being tried
 * (no Retry then: it could send twice); Failed only once it stopped, with the reason and Retry.
 * View shows the saved message. Refreshed every 30 seconds while the page is open.
 */
import { useIntervalFn } from '@vueuse/core'
import type { TableColumn } from '@nuxt/ui'
import type { NotificationDelivery } from '#shared/contracts/notifications'
import { useDeliveries, useNotificationMutations } from '../composables/useTelegram'
import DeliverySnapshotModal from './DeliverySnapshotModal.vue'

const { data, error, loading, refresh } = useDeliveries()
const { retry } = useNotificationMutations()
const { isCompact } = useLayoutContext()

useIntervalFn(() => {
  if (!loading.value) refresh()
}, 30_000)

const deliveries = computed(() => data.value?.deliveries ?? [])

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

function status(delivery: NotificationDelivery): { label: string, color: 'success' | 'neutral' | 'warning' | 'error' } {
  if (delivery.status === 'sent') return { label: 'Sent', color: 'success' }
  if (delivery.status === 'failed') return { label: 'Failed', color: 'error' }
  if (delivery.attempts > 0 && delivery.nextAttemptAt) return { label: `Retrying at ${clock(delivery.nextAttemptAt)}`, color: 'warning' }
  return { label: 'Pending', color: 'neutral' }
}

const snapshotModal = useOverlay().create(DeliverySnapshotModal)
const view = (delivery: NotificationDelivery) => snapshotModal.open({ id: delivery.id, subject: delivery.subject })

const columns: TableColumn<NotificationDelivery>[] = [
  { accessorKey: 'createdAt', header: 'Time' },
  { accessorKey: 'subject', header: 'What' },
  { id: 'to', header: 'To' },
  { accessorKey: 'status', header: 'Status' },
  { id: 'actions', meta: { class: { td: 'text-right' } } },
]
</script>

<template>
  <UCard
    as="section"
    aria-labelledby="delivery-history"
    :ui="{ body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <h2
        id="delivery-history"
        class="font-semibold text-highlighted"
      >
        Delivery history
      </h2>
      <p class="text-sm text-muted">
        The latest 50 messages. A message that doesn't go through is tried again for a few hours.
      </p>
    </template>

    <div
      v-if="error"
      class="p-4"
    >
      <ApiErrorAlert
        :error="error"
        title="Could not load the history"
        @retry="refresh()"
      />
    </div>
    <ListSkeleton
      v-else-if="loading"
      label="Loading the history…"
      :count="3"
    />
    <p
      v-else-if="!deliveries.length"
      class="p-4 text-sm text-muted sm:p-6"
    >
      Nothing sent yet.
    </p>

    <!-- Phones: one row each -->
    <ul
      v-else-if="isCompact"
      aria-label="Delivery history"
      class="divide-y divide-default"
    >
      <li
        v-for="delivery in deliveries"
        :key="delivery.id"
        class="space-y-1 p-4"
      >
        <div class="flex items-start justify-between gap-2">
          <p class="font-medium break-words text-highlighted">
            {{ delivery.subject }}
          </p>
          <UBadge
            v-bind="status(delivery)"
            variant="subtle"
            class="shrink-0"
          />
        </div>
        <p class="text-sm text-muted">
          {{ delivery.destination.title }} · {{ when(delivery.createdAt) }}
        </p>
        <p
          v-if="delivery.lastError && delivery.status !== 'sent'"
          class="text-sm text-muted"
        >
          {{ delivery.lastError }}
        </p>
        <div class="flex gap-2 pt-1">
          <UButton
            label="View"
            color="neutral"
            variant="outline"
            size="sm"
            :aria-label="`View ${delivery.subject}`"
            @click="view(delivery)"
          />
          <UButton
            v-if="delivery.status === 'failed'"
            label="Retry"
            color="neutral"
            variant="outline"
            size="sm"
            :loading="retry.isPending(delivery.id)"
            :aria-label="`Retry ${delivery.subject}`"
            @click="retry.execute(delivery)"
          />
        </div>
      </li>
    </ul>

    <UTable
      v-else
      :data="deliveries"
      :columns="columns"
    >
      <template #createdAt-cell="{ row }">
        <span class="whitespace-nowrap text-muted">{{ when(row.original.createdAt) }}</span>
      </template>
      <template #subject-cell="{ row }">
        <span class="font-medium text-highlighted">{{ row.original.subject }}</span>
      </template>
      <template #to-cell="{ row }">
        {{ row.original.destination.title }}
      </template>
      <template #status-cell="{ row }">
        <div class="space-y-1">
          <UBadge
            v-bind="status(row.original)"
            variant="subtle"
          />
          <p
            v-if="row.original.lastError && row.original.status !== 'sent'"
            class="max-w-xs text-xs whitespace-normal text-muted"
          >
            {{ row.original.lastError }}
          </p>
        </div>
      </template>
      <template #actions-cell="{ row }">
        <div class="flex justify-end gap-1">
          <UButton
            v-if="row.original.status === 'failed'"
            label="Retry"
            color="neutral"
            variant="outline"
            size="sm"
            :loading="retry.isPending(row.original.id)"
            :aria-label="`Retry ${row.original.subject}`"
            @click="retry.execute(row.original)"
          />
          <UButton
            label="View"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="`View ${row.original.subject}`"
            @click="view(row.original)"
          />
        </div>
      </template>
    </UTable>
  </UCard>
</template>
