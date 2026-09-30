<script setup lang="ts">
/**
 * Reports → Order history (`/admin/reports/orders`, step 8.1b, D111, the owner's frames): the orders
 * placed in the period, newest first, with their payment and progress as two columns (D110). Search
 * by order number; Type, Payment, Progress and Method filters apply at once from `sm`; on phones
 * they sit in a sheet applied with Apply filters, shown as removable chips. `?order=<id>` opens the
 * order (a side panel, full screen on phones); Back closes it.
 */
import type { TableColumn } from '@nuxt/ui'
import type { OrderStatus, OrderType, PaymentMethod } from '#shared/contracts/orders'
import type { OrderHistoryRow, PaymentState } from '#shared/contracts/reports'
import { useOrderHistory, useReportDownload, useReportScope } from '../composables/useReports'
import { METHOD_LABELS, orderNumber, orderTypeText, PAYMENT_LABELS, paymentBadge, PROGRESS_LABELS, progressBadge, stampIn, TYPE_LABELS } from '../utils/display'
import OrderDetailPanel from './OrderDetailPanel.vue'
import ReportDefinitions from './ReportDefinitions.vue'
import ReportHeader from './ReportHeader.vue'
import ReportPrintHeader from './ReportPrintHeader.vue'
import SortButton from './SortButton.vue'

type Sort = 'placed' | 'total' | 'number'

const { branches, branch, period, scope, setPeriod, setBranch } = useReportScope()
const { isCompact } = useLayoutContext()
const route = useRoute()
const router = useRouter()

const { page, pageSize, filters, query } = usePaginatedQuery({
  search: '',
  type: ANY as OrderType | Any,
  payment: ANY as PaymentState | Any,
  progress: ANY as OrderStatus | Any,
  method: ANY as PaymentMethod | Any,
  sort: 'placed' as Sort,
  direction: 'desc' as 'asc' | 'desc',
})

const FILTERS = ['type', 'payment', 'progress', 'method'] as const
type FilterKey = typeof FILTERS[number]

const activeFilters = computed(() => FILTERS.filter(key => filters[key] !== ANY))
const isFiltered = computed(() => filters.search !== '' || activeFilters.value.length > 0)
function clearFilters() {
  filters.search = ''
  for (const key of FILTERS) filters[key] = ANY
}

// Order numbers are digits (the server refuses anything else): other characters are ignored.
const request = computed(() => scope.value
  ? { ...scope.value, ...query.value, search: query.value.search?.replace(/\D/g, '').slice(0, 4) || undefined }
  : undefined)
const history = useOrderHistory(request)
const download = useReportDownload()

const data = computed(() => history.data.value ?? undefined)
const error = computed(() => branches.error.value ?? history.error.value)
const retry = () => (branches.error.value ? branches.refresh() : history.refresh())

watch(() => data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})

interface Option { label: string, value: string }
const options = <T extends string>(all: string, labels: Record<T, string>): Option[] => [
  { label: all, value: ANY },
  ...Object.entries<string>(labels).map(([value, label]) => ({ label, value })),
]
const FILTER_ITEMS: Record<FilterKey, { label: string, items: Option[] }> = {
  type: { label: 'Type', items: options('All types', TYPE_LABELS) },
  payment: { label: 'Payment', items: options('Any payment', PAYMENT_LABELS) },
  progress: { label: 'Progress', items: options('Any progress', PROGRESS_LABELS) },
  method: { label: 'Method', items: options('Any method', METHOD_LABELS) },
}
/** "Paid", "Dine-in": the chip of a filter in force. */
const chipLabel = (key: FilterKey) => FILTER_ITEMS[key].items.find(item => item.value === filters[key])?.label ?? filters[key]

// --- Phones: the filter sheet keeps a draft until Apply ---
const sheetOpen = ref(false)
const draft = reactive<Record<FilterKey, string>>({ type: ANY, payment: ANY, progress: ANY, method: ANY })
watch(sheetOpen, (isOpen) => {
  if (isOpen) for (const key of FILTERS) draft[key] = filters[key]
})
function applyDraft() {
  Object.assign(filters, draft)
  sheetOpen.value = false
}
function resetDraft() {
  for (const key of FILTERS) draft[key] = ANY
}

function sortBy(column: Sort, direction: 'asc' | 'desc') {
  filters.sort = column
  filters.direction = direction
}

const columns: TableColumn<OrderHistoryRow>[] = [
  { accessorKey: 'pickupNumber', header: 'Order' },
  { accessorKey: 'placedAt', header: 'Placed at' },
  { accessorKey: 'orderType', header: 'Type' },
  { id: 'payment', header: 'Payment' },
  { accessorKey: 'status', header: 'Progress' },
  { accessorKey: 'totalMinor', header: 'Total', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } },
]

// --- The order panel, in the URL ---
const openId = computed(() => (typeof route.query.order === 'string' && route.query.order) || undefined)
let pushedFor: string | undefined
function openOrder(row: OrderHistoryRow) {
  if (openId.value === row.id) return
  pushedFor = row.id
  router.push({ query: { ...route.query, order: row.id } })
}
const panelOpen = computed({
  get: () => Boolean(openId.value),
  set: (value) => {
    if (value || !openId.value) return
    // Opened from this list: Back is the same as closing. Opened from a link: just drop `order`.
    if (pushedFor === openId.value) {
      pushedFor = undefined
      router.back()
    }
    else {
      const { order: _, ...rest } = route.query
      router.replace({ query: rest })
    }
  },
})

function downloadCsv() {
  if (!request.value || !branch.value) return
  download.execute({ kind: 'orders', branchName: branch.value.name, query: request.value })
}
const printPage = () => window.print()

const range = computed(() => {
  if (!data.value?.total) return ''
  const first = (data.value.page - 1) * data.value.pageSize + 1
  return `${first}–${first + data.value.orders.length - 1} of ${data.value.total.toLocaleString('en-US')}`
})
const zone = computed(() => data.value?.branch.timeZone ?? branch.value?.timeZone ?? 'UTC')
</script>

<template>
  <UDashboardPanel
    id="report-orders"
    :ui="{ root: 'print:min-h-0', body: 'print:overflow-visible print:p-0' }"
  >
    <template #header>
      <ReportHeader
        title="Order history"
        :branches="branches.data.value ?? []"
        :branch="branch"
        :period="period"
        :as-of="data?.asOf"
        :refreshing="history.refreshing.value"
        :downloading="download.isPending('orders')"
        @period="setPeriod"
        @branch="setBranch"
        @download="downloadCsv"
        @print="printPage"
      />
      <UDashboardToolbar
        class="print:hidden"
        :ui="{ root: 'h-auto min-h-(--ui-header-height) py-2', left: 'flex-wrap gap-2' }"
      >
        <template #left>
          <SearchInput
            v-model="filters.search"
            placeholder="Order number"
            class="min-w-0 flex-1 sm:w-40 sm:flex-none"
          />
          <UDrawer
            v-if="isCompact"
            v-model:open="sheetOpen"
            title="Filters"
            :ui="{ body: 'space-y-4', footer: 'flex-row gap-2' }"
          >
            <UButton
              :label="activeFilters.length ? `Filters (${activeFilters.length})` : 'Filters'"
              icon="i-lucide-sliders-horizontal"
              color="neutral"
              :variant="activeFilters.length ? 'soft' : 'outline'"
            />
            <template #body>
              <UFormField
                v-for="key in FILTERS"
                :key="key"
                :label="FILTER_ITEMS[key].label"
              >
                <USelect
                  v-model="draft[key]"
                  :items="FILTER_ITEMS[key].items"
                  class="w-full"
                />
              </UFormField>
            </template>
            <template #footer>
              <UButton
                label="Reset"
                color="neutral"
                variant="outline"
                class="flex-1 justify-center"
                @click="resetDraft"
              />
              <UButton
                label="Apply filters"
                class="flex-1 justify-center"
                @click="applyDraft"
              />
            </template>
          </UDrawer>
          <template v-else>
            <USelect
              v-for="key in FILTERS"
              :key="key"
              v-model="filters[key]"
              :items="FILTER_ITEMS[key].items"
              :aria-label="FILTER_ITEMS[key].label"
              class="w-40"
            />
          </template>
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <!-- Phones: the filters in force, each removable -->
      <div
        v-if="isCompact && activeFilters.length"
        class="flex flex-wrap gap-2 print:hidden"
        aria-label="Filters in force"
      >
        <UButton
          v-for="key in activeFilters"
          :key="key"
          :label="chipLabel(key)"
          trailing-icon="i-lucide-x"
          color="neutral"
          variant="soft"
          size="sm"
          :aria-label="`Remove filter: ${FILTER_ITEMS[key].label}`"
          @click="filters[key] = ANY"
        />
      </div>

      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Couldn't load the orders"
        @retry="retry()"
      />

      <ListSkeleton
        v-else-if="!data"
        label="Loading orders…"
      />

      <template v-else>
        <ReportPrintHeader
          title="Order history"
          :report="data"
        />

        <ListEmptyState
          v-if="!data.orders.length && isFiltered"
          noun="orders"
          filtered
          @clear="clearFilters()"
        />
        <p
          v-else-if="!data.orders.length"
          class="py-10 text-center text-sm text-muted"
        >
          No orders were placed in this period.
        </p>

        <template v-else>
          <ul
            v-if="isCompact"
            aria-label="Orders"
            class="divide-y divide-default rounded-lg border border-default"
          >
            <li
              v-for="order in data.orders"
              :key="order.id"
              class="p-1"
            >
              <UButton
                color="neutral"
                :variant="openId === order.id ? 'soft' : 'ghost'"
                :aria-label="`Order ${orderNumber(order.pickupNumber)}`"
                class="w-full text-left"
                @click="openOrder(order)"
              >
                <span class="flex w-full min-w-0 items-start justify-between gap-3">
                  <span class="flex min-w-0 flex-col gap-1">
                    <span class="font-semibold text-highlighted tabular-nums">{{ orderNumber(order.pickupNumber) }}
                      <span class="font-normal text-muted">· {{ orderTypeText(order) }}</span>
                    </span>
                    <span class="text-xs font-normal text-muted">{{ stampIn(order.placedAt, zone) }}</span>
                    <span class="flex flex-wrap gap-1">
                      <UBadge
                        v-bind="paymentBadge(order.payment)"
                        variant="subtle"
                        size="sm"
                      />
                      <UBadge
                        v-bind="progressBadge(order.status)"
                        variant="outline"
                        size="sm"
                      />
                    </span>
                  </span>
                  <span class="shrink-0 font-medium text-highlighted tabular-nums">{{ formatMinor(order.totalMinor) }}</span>
                </span>
              </UButton>
            </li>
          </ul>

          <UTable
            v-else
            :data="data.orders"
            :columns="columns"
            class="shrink-0"
            :meta="{ class: { tr: row => (row.original.id === openId ? 'bg-elevated/50' : '') } }"
          >
            <template #pickupNumber-header>
              <SortButton
                label="Order"
                column="number"
                first="asc"
                :sort="filters.sort"
                :direction="filters.direction"
                @sort="sortBy"
              />
            </template>
            <template #placedAt-header>
              <SortButton
                label="Placed at"
                column="placed"
                :sort="filters.sort"
                :direction="filters.direction"
                @sort="sortBy"
              />
            </template>
            <template #totalMinor-header>
              <SortButton
                label="Total"
                column="total"
                align="right"
                :sort="filters.sort"
                :direction="filters.direction"
                @sort="sortBy"
              />
            </template>

            <!-- The number opens the order: the row's one target -->
            <template #pickupNumber-cell="{ row }">
              <UButton
                :label="orderNumber(row.original.pickupNumber)"
                :aria-label="`Order ${orderNumber(row.original.pickupNumber)}`"
                color="neutral"
                variant="ghost"
                class="-mx-2.5 font-semibold text-highlighted tabular-nums"
                @click="openOrder(row.original)"
              />
            </template>
            <template #placedAt-cell="{ row }">
              {{ stampIn(row.original.placedAt, zone) }}
            </template>
            <template #orderType-cell="{ row }">
              {{ orderTypeText(row.original) }}
            </template>
            <template #payment-cell="{ row }">
              <UBadge
                v-bind="paymentBadge(row.original.payment)"
                variant="subtle"
              />
            </template>
            <template #status-cell="{ row }">
              <UBadge
                v-bind="progressBadge(row.original.status)"
                variant="outline"
              />
            </template>
            <template #totalMinor-cell="{ row }">
              {{ formatMinor(row.original.totalMinor) }}
            </template>
          </UTable>

          <div class="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <p class="text-sm text-muted">
              {{ range }} · The CSV includes all matching orders.
            </p>
            <UPagination
              v-if="data.totalPages > 1"
              v-model:page="page"
              :total="data.total"
              :items-per-page="pageSize"
            />
          </div>
        </template>

        <ReportDefinitions kind="orders" />
      </template>

      <OrderDetailPanel
        v-model:open="panelOpen"
        :order-id="openId"
      />
    </template>
  </UDashboardPanel>
</template>
