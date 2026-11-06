<script setup lang="ts">
/**
 * The counter's queue (`/counter/<branchId>`, step 6.3b, D102, the owner's frames): To pay ·
 * Preparing · Ready, oldest first, refreshed every 10 seconds. Three columns from `sm` (a tablet at
 * the counter); on phones one list at a time, as tabs with counts. A card's one action: Take
 * payment (opens the order), Mark ready, Complete. Search by number or name. Queue | Finished today
 * (N) switches to today's finished orders (step 10.2, D117). New orders are marked
 * for a minute, with a chime (mute it in the user menu). A closed branch says when it opens.
 * While refreshing fails, the queue says when it last loaded; the tab's title counts the orders to
 * pay (D149). After 2 minutes of that, it warns louder; a browser that holds the chime back until a
 * tap says so (D150). An order arriving, moving to another column or leaving slides in and out
 * (D263); searching, changing tab or branch shows the new cards at once.
 *
 * From `sm` the board fills the screen and each column scrolls under its title and count, so all
 * three stay in sight (D269); on phones the page scrolls and the tabs stick under the header.
 *
 * Browser-only (`routeRules`), so the width can choose what renders (`useLayoutContext`).
 */
import type { PublicBranch } from '#shared/contracts/branches'
import type { CounterOrder } from '#shared/contracts/orders'
import { openingText } from '~/features/menu'
import { useBranchPause } from '../composables/useBranchPause'
import { useCounterActions } from '../composables/useCounterActions'
import { useCounterQueue } from '../composables/useCounterQueue'
import { useCounterSession } from '../composables/useCounterSession'
import type { ColumnId } from '../utils/counter'
import { COLUMNS, lastUpdatedText, matchesSearch, queueLongStale, queueTitle } from '../utils/counter'
import CounterCancelModal from './CounterCancelModal.vue'
import CounterHeader from './CounterHeader.vue'
import CounterOrderCard from './CounterOrderCard.vue'
import CounterOrderPanel from './CounterOrderPanel.vue'
import CounterViewSwitch from './CounterViewSwitch.vue'

const tenantPath = useTenantPath()

const route = useRoute()
const branchId = computed(() => String(route.params.branchId ?? ''))
const { user, signingOut } = useCounterSession()
const branch = computed(() => user.value?.branches.find(b => b.id === branchId.value) ?? null)

const { query, queue, now, serverOffset, updatedAt, localNow, isNew, muted, sound } = useCounterQueue(branchId)
// Two minutes without an update while refreshing fails: a red alert, "⚠" in the tab and a warning
// sound once, for a cashier who isn't looking at the screen (D150).
const longStale = computed(() => queueLongStale(Boolean(query.error.value), updatedAt.value, localNow.value))
watch(longStale, (stale) => {
  if (stale && !muted.value) sound.warning()
})
// The tab says how many orders wait for payment, so a background tab still shows them (D149).
useHead({ title: () => queueTitle(queue.value?.orders ?? [], longStale.value) })
const status = useApiQuery('counter:branch-status', () => apiFetch<PublicBranch[]>('/public/branches'), { server: false })
const branchStatus = computed(() => status.data.value?.find(b => b.id === branchId.value) ?? null)
const closedNote = computed(() => (branchStatus.value ? openingText(branchStatus.value) : undefined))
// Online orders paused (D199): refreshed with the board, so another tablet's pause shows here too.
const { query: pauseQuery, pausedUntil, resume } = useBranchPause(branchId)
watch(updatedAt, (loadedAt) => {
  if (loadedAt && user.value && !signingOut.value) void pauseQuery.refresh()
})
const pause = computed(() => pauseQuery.data.value)
const canResume = computed(() => !!branch.value && branch.value.role !== 'staff')
const pauseDetail = computed(() => [pause.value?.pausedByName && `By ${pause.value.pausedByName}`, pause.value?.reason].filter(Boolean).join(' · ') || undefined)

const { isCompact } = useLayoutContext()
const actions = useCounterActions(branchId)

const search = ref('')
const orders = computed(() => (queue.value?.orders ?? []).filter(order => matchesSearch(order, search.value)))
const columns = computed(() => COLUMNS.map(column => ({ ...column, orders: orders.value.filter(order => order.status === column.status) })))
// A column's one color signal (D269): the rule under its title and its icon; the count is a soft badge.
const COLUMN_ACCENT = {
  warning: { rule: 'border-warning', icon: 'text-warning' },
  info: { rule: 'border-info', icon: 'text-info' },
  success: { rule: 'border-success', icon: 'text-success' },
} as const
const tab = ref<ColumnId>('to_pay')
const tabsRow = useTemplateRef('tabsRow')
useCenteredTab(tabsRow, () => tab.value)
const tabItems = computed(() => columns.value.map(column => ({ label: column.label, value: column.id, badge: { label: String(column.orders.length), color: column.color, variant: 'subtle' as const } })))
// Rows that come and go with the data animate; a search, tab, branch or layout change is not that.
const listTransition = useListTransition({ instantWhen: [search, tab, branchId, isCompact] })
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
  <div class="flex min-h-dvh flex-col sm:h-dvh">
    <CounterHeader
      v-model:search="search"
      :branch-id="branchId"
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

    <!-- Scrolls only when banners leave the board less than its minimum height (a short window, 200% zoom). -->
    <div
      v-else
      class="mx-auto flex w-full max-w-7xl flex-1 flex-col sm:min-h-0 sm:overflow-y-auto"
    >
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
        v-if="pausedUntil && branchStatus?.openNow !== false"
        class="px-4 pt-3"
      >
        <!-- A status, announced politely: another tablet's pause appears here without a click. -->
        <UAlert
          role="status"
          color="warning"
          variant="subtle"
          icon="i-lucide-pause"
          :title="`Online orders paused until ${formatTime(pausedUntil)}`"
          :description="pauseDetail ? `${pauseDetail}. Orders already placed carry on.` : 'Orders already placed carry on.'"
          :orientation="isCompact ? 'vertical' : 'horizontal'"
          :actions="canResume ? [{ label: 'Resume now', color: 'warning', variant: 'solid', loading: resume.isPending(branchId), onClick: () => void resume.execute(branchId) }] : undefined"
        />
      </div>
      <div
        v-if="sound.blocked.value && !muted"
        class="px-4 pt-3"
      >
        <UAlert
          color="info"
          variant="subtle"
          icon="i-lucide-volume-x"
          title="Sound is off until you tap the screen"
          description="The browser holds back the new-order chime after the page loads."
          orientation="horizontal"
          :actions="[{ label: 'Turn on sound', color: 'info', variant: 'solid', onClick: () => sound.unlock() }]"
        />
      </div>
      <div
        v-if="query.error.value && queue"
        class="px-4 pt-3"
      >
        <UAlert
          :color="longStale ? 'error' : 'warning'"
          variant="subtle"
          icon="i-lucide-wifi-off"
          :title="longStale ? 'The queue isn\'t updating: check the connection' : 'The queue may be out of date'"
          :description="`${updatedAt ? `${lastUpdatedText(updatedAt, localNow)}. ` : ''}New orders show up once it can refresh again; it keeps trying every 10 seconds.`"
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
        role="status"
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
        <!-- top-22: the header's height on a phone, with the search on its own row. -->
        <UTabs
          ref="tabsRow"
          v-model="tab"
          :items="tabItems"
          :content="false"
          variant="link"
          class="sticky top-22 z-10 w-full bg-default px-2"
          aria-label="Queue"
        />
        <TransitionGroup
          tag="div"
          class="relative space-y-3 p-4"
          v-bind="listTransition"
        >
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
            key="empty"
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
              v-if="empty && tab === 'to_pay'"
              class="text-sm text-muted"
            >
              New orders appear here automatically.
            </p>
          </div>
        </TransitionGroup>
      </div>

      <!-- Tablets and wider: the board. Every column is the full height and scrolls by itself. -->
      <div
        v-else
        class="grid min-h-72 flex-1 grid-cols-3 grid-rows-1 gap-3 p-4"
      >
        <section
          v-for="column in columns"
          :key="column.id"
          class="flex min-h-0 flex-col overflow-hidden rounded-lg bg-elevated/50 ring ring-default dark:bg-default dark:ring-accented"
          :aria-labelledby="`column-${column.id}`"
        >
          <h2
            :id="`column-${column.id}`"
            class="flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 font-semibold text-highlighted"
            :class="COLUMN_ACCENT[column.color].rule"
          >
            <UIcon
              :name="column.icon"
              class="size-5 shrink-0"
              :class="COLUMN_ACCENT[column.color].icon"
            />
            <span class="min-w-0 flex-1 truncate">{{ column.label }}</span>
            <UBadge
              :label="String(column.orders.length)"
              :color="column.color"
              variant="subtle"
              class="tabular-nums"
            />
          </h2>
          <TransitionGroup
            tag="div"
            class="relative min-h-0 flex-1 space-y-3 overflow-y-auto p-2 lg:p-3"
            v-bind="listTransition"
          >
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
              v-if="!column.orders.length && !(empty && column.id === 'to_pay')"
              key="none"
              class="py-6 text-center text-sm text-muted"
            >
              {{ search.trim() && !empty ? 'No matching orders' : 'None right now' }}
            </p>
            <!-- In the column new orders arrive in. -->
            <div
              v-if="empty && column.id === 'to_pay'"
              key="empty"
              class="flex flex-col items-center gap-2 py-10 text-center"
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
          </TransitionGroup>
        </section>
      </div>
    </div>

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
