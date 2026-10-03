<script setup lang="ts">
/**
 * The counter's queue (`/counter/<branchId>`, step 6.3b, D102, the owner's frames): To pay ·
 * Preparing · Ready, oldest first, refreshed every 10 seconds. Three columns from `sm` (a tablet at
 * the counter); on phones one list at a time, as tabs with counts. A card's one action: Take
 * payment (opens the order), Mark ready, Complete. Search by number or name. Queue | Finished today
 * (N) switches to today's finished orders (step 10.2, D117). New orders are marked
 * for a minute, with a chime (mute it in the user menu). A closed branch says when it opens.
 *
 * Browser-only (`routeRules`), so the width can choose what renders (`useLayoutContext`).
 */
import type { PublicBranch } from '#shared/contracts/branches'
import type { CounterOrder } from '#shared/contracts/orders'
import { openingText } from '~/features/menu'
import { useCounterActions } from '../composables/useCounterActions'
import { useCounterQueue } from '../composables/useCounterQueue'
import { useCounterSession } from '../composables/useCounterSession'
import type { ColumnId } from '../utils/counter'
import { COLUMNS, matchesSearch } from '../utils/counter'
import CounterCancelModal from './CounterCancelModal.vue'
import CounterHeader from './CounterHeader.vue'
import CounterOrderCard from './CounterOrderCard.vue'
import CounterOrderPanel from './CounterOrderPanel.vue'
import CounterViewSwitch from './CounterViewSwitch.vue'

const tenantPath = useTenantPath()

const route = useRoute()
const branchId = computed(() => String(route.params.branchId ?? ''))
const { user } = useCounterSession()
const branch = computed(() => user.value?.branches.find(b => b.id === branchId.value) ?? null)

const { query, queue, now, serverOffset, isNew, muted } = useCounterQueue(branchId)
const status = useApiQuery('counter:branch-status', () => apiFetch<PublicBranch[]>('/public/branches'), { server: false })
const branchStatus = computed(() => status.data.value?.find(b => b.id === branchId.value) ?? null)
const closedNote = computed(() => (branchStatus.value ? openingText(branchStatus.value) : undefined))

const { isCompact } = useLayoutContext()
const actions = useCounterActions(branchId)

const search = ref('')
const orders = computed(() => (queue.value?.orders ?? []).filter(order => matchesSearch(order, search.value)))
const columns = computed(() => COLUMNS.map(column => ({ ...column, orders: orders.value.filter(order => order.status === column.status) })))
const tab = ref<ColumnId>('to_pay')
const tabsRow = useTemplateRef('tabsRow')
useCenteredTab(tabsRow, () => tab.value)
const tabItems = computed(() => columns.value.map(column => ({ label: column.label, value: column.id, badge: { label: String(column.orders.length), color: column.color, variant: 'subtle' as const } })))
const shownColumn = computed(() => columns.value.find(column => column.id === tab.value)!)
const empty = computed(() => queue.value !== null && queue.value.orders.length === 0)

// --- The order panel and the cancel dialog ---
const selectedId = ref<string | null>(null)
const panelOpen = ref(false)
const selected = computed(() => queue.value?.orders.find(order => order.id === selectedId.value) ?? null)
const cancelOpen = ref(false)
const cancelTarget = ref<CounterOrder | null>(null)

function openOrder(order: CounterOrder) {
  selectedId.value = order.id
  panelOpen.value = true
}

function act(order: CounterOrder) {
  if (order.status === 'awaiting_payment') openOrder(order)
  else if (order.status === 'preparing') void actions.markReady.execute(order)
  else if (order.status === 'ready') void actions.complete.execute(order)
}

function askCancel(order: CounterOrder) {
  cancelTarget.value = order
  cancelOpen.value = true
}

function afterCancel() {
  panelOpen.value = false
}

const reload = () => query.refresh()

// `?order=<id>`: Telegram's "Open order" (D113, R2). Opens it once the queue has loaded, then leaves
// the URL, so a reload doesn't open it again. An order no longer in the queue opens on Finished
// today (step 10.2), whose panel reads any of the branch's orders.
const router = useRouter()
watch(() => [route.query.order, queue.value] as const, ([orderId, loaded]) => {
  if (typeof orderId !== 'string' || !orderId || !loaded) return
  const order = loaded.orders.find(o => o.id === orderId)
  if (order) {
    openOrder(order)
    const { order: _, ...rest } = route.query
    router.replace({ query: rest })
  }
  else {
    router.replace({ path: tenantPath(`/counter/${branchId.value}/finished`), query: { order: orderId } })
  }
}, { immediate: true })

useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <CounterHeader
      v-model:search="search"
      v-model:muted="muted"
      :branch-name="branch?.name ?? 'Branch'"
      :open-now="branchStatus ? branchStatus.openNow : null"
      :sold-out-to="branch ? tenantPath(`/counter/${branch.id}/sold-out`) : undefined"
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
        :to="tenantPath('/counter')"
      />
    </div>

    <template v-else>
      <CounterViewSwitch
        :branch-id="branchId"
        current="queue"
        :finished-count="queue?.finishedToday ?? null"
      />
      <div
        v-if="closedNote || (branchStatus && !branchStatus.openNow)"
        class="px-4 pt-3"
      >
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-clock"
          :title="closedNote ? `Closed now · ${closedNote}` : 'Closed now'"
        />
      </div>
      <div
        v-if="query.error.value && queue"
        class="px-4 pt-3"
      >
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-wifi-off"
          title="Couldn't refresh the queue. Showing it as it was; trying again."
        />
      </div>

      <div
        v-if="query.error.value && !queue"
        class="p-4"
      >
        <ApiErrorAlert
          :error="query.error.value"
          title="Couldn't load the queue"
          @retry="reload()"
        />
      </div>

      <div
        v-else-if="!queue"
        class="grid flex-1 gap-3 p-4 sm:grid-cols-3"
        aria-busy="true"
        aria-label="Loading the queue"
      >
        <USkeleton
          v-for="n in 3"
          :key="n"
          class="h-64"
        />
      </div>

      <!-- Phones: one list at a time -->
      <div
        v-else-if="isCompact"
        class="flex-1"
      >
        <UTabs
          ref="tabsRow"
          v-model="tab"
          :items="tabItems"
          :content="false"
          variant="link"
          class="sticky top-16 z-10 w-full bg-default px-2"
          aria-label="Queue"
        />
        <div class="space-y-3 p-3">
          <CounterOrderCard
            v-for="order in shownColumn.orders"
            :key="order.id"
            :order="order"
            :now="now"
            :is-new="isNew(order)"
            :busy="actions.isBusy(order)"
            @open="openOrder(order)"
            @action="act(order)"
          />
          <div
            v-if="!shownColumn.orders.length"
            class="flex flex-col items-center gap-2 py-16 text-center"
          >
            <UIcon
              name="i-lucide-receipt"
              class="size-10 text-dimmed"
            />
            <p class="font-semibold text-highlighted">
              {{ empty ? 'No orders yet' : search.trim() ? 'No matching orders' : 'None right now' }}
            </p>
            <p
              v-if="empty"
              class="text-sm text-muted"
            >
              New orders appear here automatically.
            </p>
          </div>
        </div>
      </div>

      <!-- Tablets and wider: the board -->
      <div
        v-else
        class="grid flex-1 grid-cols-3 gap-3 p-4"
      >
        <section
          v-for="column in columns"
          :key="column.id"
          class="flex min-h-0 flex-col rounded-lg bg-elevated/50"
          :aria-labelledby="`column-${column.id}`"
        >
          <h2
            :id="`column-${column.id}`"
            class="flex items-center gap-2 border-b-2 px-3 py-2 font-semibold text-highlighted"
            :class="{ 'border-warning': column.color === 'warning', 'border-info': column.color === 'info', 'border-success': column.color === 'success' }"
          >
            {{ column.label }}
            <UBadge
              :label="String(column.orders.length)"
              :color="column.color"
              variant="subtle"
              size="sm"
            />
          </h2>
          <div class="space-y-3 overflow-y-auto p-3">
            <CounterOrderCard
              v-for="order in column.orders"
              :key="order.id"
              :order="order"
              :now="now"
              :is-new="isNew(order)"
              :busy="actions.isBusy(order)"
              @open="openOrder(order)"
              @action="act(order)"
            />
            <p
              v-if="!column.orders.length && !empty"
              class="py-6 text-center text-sm text-muted"
            >
              {{ search.trim() ? 'No matching orders' : 'None right now' }}
            </p>
            <div
              v-if="empty && column.id === 'preparing'"
              class="flex flex-col items-center gap-2 py-16 text-center"
            >
              <UIcon
                name="i-lucide-receipt"
                class="size-10 text-dimmed"
              />
              <p class="font-semibold text-highlighted">
                No orders yet
              </p>
              <p class="text-sm text-muted">
                New orders appear here automatically.
              </p>
            </div>
          </div>
        </section>
      </div>
    </template>

    <CounterOrderPanel
      v-model:open="panelOpen"
      :order="selected"
      :branch-id="branchId"
      :khr-rate="queue?.khrRate ?? null"
      :khqr="queue?.khqr ?? null"
      :server-offset="serverOffset"
      @cancel="askCancel"
      @reload="reload()"
    />
    <CounterCancelModal
      v-model:open="cancelOpen"
      :order="cancelTarget"
      :branch-id="branchId"
      @cancelled="afterCancel"
      @reload="reload()"
    />
  </div>
</template>
