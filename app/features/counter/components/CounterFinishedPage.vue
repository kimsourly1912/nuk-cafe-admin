<script setup lang="ts">
/**
 * "Finished today" (`/counter/<branchId>/finished`, step 10.2, D117, the owner's frames): today's
 * orders that left the queue, completed or cancelled, the most recently finished first, so a
 * cashier can look one up. Search by number or name, All / Completed / Cancelled with counts. A
 * table from `sm` (the order number opens it), rows on phones. The order opens beside the list
 * from `lg`, in a side panel below that, full screen on phones. Read only.
 *
 * Browser-only (`routeRules`), so the width can choose what renders (`useLayoutContext`).
 */
import type { TableColumn } from '@nuxt/ui'
import type { PublicBranch } from '#shared/contracts/branches'
import type { CounterOrder } from '#shared/contracts/orders'
import { useCounterMuted } from '../composables/useCounterQueue'
import { COUNTER_HOME_PATH, useCounterSession } from '../composables/useCounterSession'
import { useFinishedToday, useOrderHistory } from '../composables/useFinishedToday'
import { clockTime, firstName, matchesSearch, orderNumber, orderTypeText } from '../utils/counter'
import type { FinishedFilter } from '../utils/finished'
import { filterFinished, finishedAt, itemSummary, paymentNote } from '../utils/finished'
import CounterHeader from './CounterHeader.vue'
import CounterHistoryPanel from './CounterHistoryPanel.vue'
import CounterViewSwitch from './CounterViewSwitch.vue'

const route = useRoute()
const branchId = computed(() => String(route.params.branchId ?? ''))
const { user } = useCounterSession()
const branch = computed(() => user.value?.branches.find(b => b.id === branchId.value) ?? null)
const muted = useCounterMuted()
const status = useApiQuery('counter:branch-status', () => apiFetch<PublicBranch[]>('/public/branches'), { server: false })
const branchStatus = computed(() => status.data.value?.find(b => b.id === branchId.value) ?? null)

const query = useFinishedToday(branchId)
const all = computed(() => query.data.value?.orders ?? [])
const search = ref('')
const filter = ref<FinishedFilter>('all')
const searched = computed(() => all.value.filter(order => matchesSearch(order, search.value)))
const shown = computed(() => filterFinished(searched.value, filter.value))
const chips = computed(() => ([
  { id: 'all', label: 'All', count: searched.value.length },
  { id: 'completed', label: 'Completed', count: filterFinished(searched.value, 'completed').length },
  { id: 'cancelled', label: 'Cancelled', count: filterFinished(searched.value, 'cancelled').length },
] as const))

const { isCompact, isExpanded } = useLayoutContext()

// --- The open order ---
const openId = ref<string | null>(null)
const history = useOrderHistory(branchId, openId)
const panelOpen = computed({
  get: () => openId.value !== null,
  set: (value: boolean) => {
    if (!value) openId.value = null
  },
})
const Slideover = resolveComponent('USlideover')
const Modal = resolveComponent('UModal')
const overlayProps = computed(() => (isCompact.value ? { fullscreen: true } : { side: 'right' as const }))
const openOrder = (order: CounterOrder) => {
  openId.value = order.id
}

// `?order=<id>`: from the queue's Open order link (Telegram, D113) once the order has finished.
// Opens it, then leaves the URL.
const router = useRouter()
watch(() => route.query.order, (orderId) => {
  if (typeof orderId !== 'string' || !orderId) return
  openId.value = orderId
  const { order: _, ...rest } = route.query
  router.replace({ query: rest })
}, { immediate: true })

const badge = (order: CounterOrder) => (order.status === 'completed'
  ? { label: 'Completed', color: 'success' as const }
  : { label: 'Cancelled', color: 'neutral' as const })

const columns: TableColumn<CounterOrder>[] = [
  { accessorKey: 'pickupNumber', header: 'Order' },
  { id: 'finished', header: 'Finished' },
  { id: 'details', header: 'Details' },
  { accessorKey: 'totalMinor', header: 'Total', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'status', header: 'Status' },
]

useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <CounterHeader
      v-model:muted="muted"
      :branch-name="branch?.name ?? 'Branch'"
      :open-now="branchStatus ? branchStatus.openNow : null"
      :sold-out-to="branch ? `/counter/${branch.id}/sold-out` : undefined"
    />

    <div
      v-if="!branch"
      class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <p class="font-medium text-highlighted">
        You don't work at this branch
      </p>
      <UButton
        label="Choose a branch"
        :to="COUNTER_HOME_PATH"
      />
    </div>

    <template v-else>
      <CounterViewSwitch
        :branch-id="branchId"
        current="finished"
        :finished-count="query.data.value ? all.length : null"
      />

      <div
        class="flex-1 gap-4 p-4"
        :class="isExpanded && openId ? 'grid grid-cols-[minmax(0,1fr)_26rem] items-start' : ''"
      >
        <section
          class="space-y-4"
          aria-labelledby="finished-title"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h1
              id="finished-title"
              class="text-xl font-semibold text-highlighted"
            >
              Finished today
            </h1>
            <SearchInput
              v-model="search"
              placeholder="Search number or name"
              class="w-full sm:w-72"
            />
          </div>
          <div
            class="flex flex-wrap gap-2"
            role="group"
            aria-label="Show"
          >
            <UButton
              v-for="chip in chips"
              :key="chip.id"
              :label="chip.label"
              :color="filter === chip.id ? 'primary' : 'neutral'"
              :variant="filter === chip.id ? 'solid' : 'outline'"
              :aria-pressed="filter === chip.id"
              @click="filter = chip.id"
            >
              <template #trailing>
                <UBadge
                  :label="String(chip.count)"
                  color="neutral"
                  :variant="filter === chip.id ? 'solid' : 'subtle'"
                  size="sm"
                />
              </template>
            </UButton>
          </div>

          <ApiErrorAlert
            v-if="query.error.value && !query.data.value"
            :error="query.error.value"
            title="Couldn't load today's finished orders"
            @retry="query.refresh()"
          />
          <ListSkeleton
            v-else-if="!query.data.value"
            label="Loading finished orders…"
            :count="5"
          />
          <div
            v-else-if="!shown.length"
            class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-default py-16 text-center"
          >
            <UIcon
              name="i-lucide-receipt"
              class="size-10 text-dimmed"
            />
            <p class="font-semibold text-highlighted">
              {{ all.length ? 'No matching orders' : 'No finished orders yet today' }}
            </p>
            <p
              v-if="!all.length"
              class="text-sm text-muted"
            >
              Orders appear here once they're picked up or cancelled.
            </p>
          </div>

          <!-- Phones: rows, the whole row opens the order -->
          <UCard
            v-else-if="isCompact"
            :ui="{ body: 'p-0 sm:p-0' }"
          >
            <ul
              class="divide-y divide-default"
              aria-label="Finished orders"
            >
              <li
                v-for="order in shown"
                :key="order.id"
              >
                <button
                  type="button"
                  class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-elevated/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                  :aria-label="`Order ${orderNumber(order)}, ${badge(order).label}`"
                  @click="openOrder(order)"
                >
                  <div class="w-16 shrink-0">
                    <p class="font-semibold text-highlighted tabular-nums">
                      {{ orderNumber(order) }}
                    </p>
                    <p class="text-sm text-muted">
                      {{ clockTime(finishedAt(order)) }}
                    </p>
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-medium text-highlighted">
                      {{ firstName(order.customer.name) }}
                    </p>
                    <p class="truncate text-sm text-muted">
                      {{ orderTypeText(order) }}
                    </p>
                  </div>
                  <div class="flex shrink-0 flex-col items-end gap-1">
                    <span class="font-medium text-highlighted">{{ formatMinor(order.totalMinor) }}</span>
                    <UBadge
                      v-bind="badge(order)"
                      variant="subtle"
                    />
                  </div>
                  <UIcon
                    name="i-lucide-chevron-right"
                    class="size-4 shrink-0 text-muted"
                  />
                </button>
              </li>
            </ul>
          </UCard>

          <!-- Tablets and wider: a table; the order number opens it -->
          <UCard
            v-else
            :ui="{ body: 'p-0 sm:p-0' }"
          >
            <UTable
              :data="shown"
              :columns="columns"
              :meta="{ class: { tr: row => (row.original.id === openId ? 'bg-elevated/50' : '') } }"
            >
              <template #pickupNumber-cell="{ row }">
                <UButton
                  :label="orderNumber(row.original)"
                  :aria-label="`Order ${orderNumber(row.original)}`"
                  color="neutral"
                  variant="ghost"
                  class="-mx-2.5 font-semibold text-highlighted tabular-nums"
                  @click="openOrder(row.original)"
                />
              </template>
              <template #finished-cell="{ row }">
                <span class="whitespace-nowrap text-muted">{{ clockTime(finishedAt(row.original)) }}</span>
              </template>
              <template #details-cell="{ row }">
                <div class="min-w-0 space-y-0.5 whitespace-normal">
                  <p class="font-medium text-highlighted">
                    {{ orderTypeText(row.original) }} · {{ firstName(row.original.customer.name) }}
                  </p>
                  <p class="text-highlighted">
                    {{ itemSummary(row.original) }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ paymentNote(row.original) }}
                  </p>
                </div>
              </template>
              <template #totalMinor-cell="{ row }">
                <span class="font-medium text-highlighted">{{ formatMinor(row.original.totalMinor) }}</span>
              </template>
              <template #status-cell="{ row }">
                <UBadge
                  v-bind="badge(row.original)"
                  variant="subtle"
                />
              </template>
            </UTable>
          </UCard>
        </section>

        <!-- From `lg`: the order beside the list -->
        <UCard
          v-if="isExpanded && openId"
          as="aside"
          aria-label="Order"
          class="sticky top-20"
          :ui="{ body: 'p-0 sm:p-0' }"
        >
          <CounterHistoryPanel
            :history="history.data.value ?? null"
            :loading="history.pending.value"
            :error="history.error.value ?? null"
            @close="openId = null"
            @retry="history.refresh()"
          />
        </UCard>
      </div>
    </template>

    <!-- Below `lg`: a side panel, full screen on phones -->
    <component
      :is="isCompact ? Modal : Slideover"
      v-if="!isExpanded"
      v-model:open="panelOpen"
      v-bind="overlayProps"
      title="Order"
      :ui="{ header: 'sr-only', body: 'p-0 sm:p-0' }"
    >
      <template #body>
        <CounterHistoryPanel
          :history="history.data.value ?? null"
          :loading="history.pending.value"
          :error="history.error.value ?? null"
          @close="openId = null"
          @retry="history.refresh()"
        />
      </template>
    </component>
  </div>
</template>
