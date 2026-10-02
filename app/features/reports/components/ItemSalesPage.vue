<script setup lang="ts">
/**
 * Reports → Sales by item (`/admin/reports/items`, step 8.1b, D111, the owner's frames): per item,
 * the quantity and paid sales of orders paid in the period and what was refunded in it (R6).
 * Search and category in the URL, sorted by the server (every column's header), 20 a page with the
 * totals of every matching item in the table's last row. The CSV holds every matching item.
 */
import type { TableColumn } from '@nuxt/ui'
import type { ItemSalesRow, ItemSalesSort } from '#shared/contracts/reports'
import { queryText, useItemSales, useReportDestinations, useReportDownload, useReportScope } from '../composables/useReports'
import { negativeMinor } from '../utils/display'
import ReportDefinitions from './ReportDefinitions.vue'
import SendToTelegramModal from './SendToTelegramModal.vue'
import ReportHeader from './ReportHeader.vue'
import ReportPrintHeader from './ReportPrintHeader.vue'
import SortButton from './SortButton.vue'
import { periodButtonLabel, periodLabel } from '../utils/period'

const { branches, branch, period, scope, setPeriod, setBranch } = useReportScope()
const { isCompact } = useLayoutContext()

const { page, pageSize, filters, query } = usePaginatedQuery({
  search: '',
  categoryId: ANY as string,
  sort: 'quantity' as ItemSalesSort,
  direction: 'desc' as 'asc' | 'desc',
})
/** Search or category (the sort isn't a filter: clearing keeps it). */
const isFiltered = computed(() => filters.search !== '' || filters.categoryId !== ANY)
function clearFilters() {
  filters.search = ''
  filters.categoryId = ANY
}

const request = computed(() => (scope.value ? { ...scope.value, ...query.value } : undefined))
const report = useItemSales(request)
const download = useReportDownload()

const data = computed(() => report.data.value ?? undefined)
const error = computed(() => branches.error.value ?? report.error.value)
const retry = () => (branches.error.value ? branches.refresh() : report.refresh())

watch(() => data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})

const categoryItems = computed(() => [
  { label: 'All categories', value: ANY },
  ...(data.value?.categories ?? []).map(c => ({ label: c.name, value: c.id })),
])

function sortBy(column: ItemSalesSort, direction: 'asc' | 'desc') {
  filters.sort = column
  filters.direction = direction
}

const columns: TableColumn<ItemSalesRow>[] = [
  { accessorKey: 'name', header: 'Item', footer: 'Totals' },
  { accessorKey: 'categoryName', header: 'Category', footer: '' },
  { accessorKey: 'quantity', header: 'Quantity sold', footer: '', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } },
  { accessorKey: 'salesMinor', header: 'Paid sales', footer: '', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } },
  { accessorKey: 'refundedMinor', header: 'Refunded', footer: '', meta: { class: { th: 'text-right', td: 'text-right tabular-nums' } } },
]

function downloadCsv() {
  if (!request.value || !branch.value) return
  download.execute({ kind: 'items', branchName: branch.value.name, query: request.value })
}
const printPage = () => window.print()

// Send to Telegram, where it's set up (D112): the message is built on the server from this query.
const telegram = useReportDestinations()
const sendModal = useOverlay().create(SendToTelegramModal)
function openSend() {
  if (!request.value || !period.value || !branch.value) return
  const label = periodButtonLabel(period.value, branch.value.today)
  const dates = periodLabel(period.value)
  sendModal.open({ kind: 'items', title: `Sales by item · ${label === dates ? dates : `${label} (${dates})`}`, query: queryText(request.value) })
}

const range = computed(() => {
  if (!data.value?.total) return ''
  const first = (data.value.page - 1) * data.value.pageSize + 1
  return `${first}–${first + data.value.items.length - 1} of ${data.value.total}`
})
</script>

<template>
  <UDashboardPanel
    id="report-items"
    :ui="{ root: 'print:min-h-0', body: 'print:overflow-visible print:p-0' }"
  >
    <template #header>
      <ReportHeader
        title="Sales by item"
        :branches="branches.data.value ?? []"
        :branch="branch"
        :period="period"
        :as-of="data?.asOf"
        :refreshing="report.refreshing.value"
        :downloading="download.isPending('items')"
        :can-send="telegram.data.value?.enabled"
        @period="setPeriod"
        @branch="setBranch"
        @download="downloadCsv"
        @print="printPage"
        @send="openSend"
      />
      <UDashboardToolbar class="print:hidden">
        <template #left>
          <SearchInput
            v-model="filters.search"
            placeholder="Find an item…"
            class="w-full sm:w-64"
          />
          <RecordSelect
            v-model="filters.categoryId"
            :items="categoryItems"
            noun="categories"
            :pinned="[ANY]"
            aria-label="Category"
            class="w-full sm:w-48"
          />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Couldn't load the report"
        @retry="retry()"
      />

      <ListSkeleton
        v-else-if="!data"
        label="Loading the report…"
      />

      <template v-else>
        <ReportPrintHeader
          title="Sales by item"
          :report="data"
        />

        <ListEmptyState
          v-if="!data.items.length && isFiltered"
          noun="items"
          filtered
          @clear="clearFilters()"
        />
        <p
          v-else-if="!data.items.length"
          class="py-10 text-center text-sm text-muted"
        >
          Nothing sold in this period.
        </p>

        <template v-else>
          <!-- Phones: one row per item, the totals first -->
          <template v-if="isCompact">
            <p class="text-sm text-muted">
              Totals for {{ data.totals.items }} {{ data.totals.items === 1 ? 'item' : 'items' }}:
              <span class="font-semibold text-highlighted tabular-nums">{{ data.totals.quantity }} sold · {{ formatMinor(data.totals.salesMinor) }}</span>
              <template v-if="data.totals.refundedMinor">
                · refunded {{ negativeMinor(data.totals.refundedMinor) }}
              </template>
            </p>
            <USelect
              :model-value="`${filters.sort}:${filters.direction}`"
              :items="[
                { label: 'Most sold', value: 'quantity:desc' },
                { label: 'Highest sales', value: 'sales:desc' },
                { label: 'Most refunded', value: 'refunded:desc' },
                { label: 'Name A–Z', value: 'name:asc' },
              ]"
              aria-label="Sort"
              class="w-full"
              @update:model-value="(value: string) => { const [column, direction] = value.split(':'); sortBy(column as ItemSalesSort, direction as 'asc' | 'desc') }"
            />
            <ul
              aria-label="Items"
              class="divide-y divide-default rounded-lg border border-default"
            >
              <li
                v-for="item in data.items"
                :key="item.itemId"
                class="flex items-start justify-between gap-3 p-3"
              >
                <div class="min-w-0">
                  <p class="font-medium break-words text-highlighted">
                    {{ item.name }}
                  </p>
                  <p class="text-sm text-muted">
                    {{ item.categoryName ?? 'No category' }}
                  </p>
                </div>
                <div class="shrink-0 text-right text-sm tabular-nums">
                  <p class="font-medium text-highlighted">
                    {{ formatMinor(item.salesMinor) }}
                  </p>
                  <p class="text-muted">
                    {{ item.quantity }} sold
                  </p>
                  <p
                    v-if="item.refundedMinor"
                    class="text-muted"
                  >
                    Refunded {{ negativeMinor(item.refundedMinor) }}
                  </p>
                </div>
              </li>
            </ul>
          </template>

          <UTable
            v-else
            :data="data.items"
            :columns="columns"
            class="shrink-0"
            :ui="{ tfoot: 'font-semibold text-highlighted', td: 'py-3' }"
          >
            <template #name-header>
              <SortButton
                label="Item"
                column="name"
                first="asc"
                :sort="filters.sort"
                :direction="filters.direction"
                @sort="sortBy"
              />
            </template>
            <template #quantity-header>
              <SortButton
                label="Quantity sold"
                column="quantity"
                align="right"
                :sort="filters.sort"
                :direction="filters.direction"
                @sort="sortBy"
              />
            </template>
            <template #salesMinor-header>
              <SortButton
                label="Paid sales"
                column="sales"
                align="right"
                :sort="filters.sort"
                :direction="filters.direction"
                @sort="sortBy"
              />
            </template>
            <template #refundedMinor-header>
              <SortButton
                label="Refunded"
                column="refunded"
                align="right"
                :sort="filters.sort"
                :direction="filters.direction"
                @sort="sortBy"
              />
            </template>

            <template #name-cell="{ row }">
              <span class="font-medium text-highlighted">{{ row.original.name }}</span>
            </template>
            <template #categoryName-cell="{ row }">
              <span class="text-muted">{{ row.original.categoryName ?? '—' }}</span>
            </template>
            <template #salesMinor-cell="{ row }">
              {{ formatMinor(row.original.salesMinor) }}
            </template>
            <template #refundedMinor-cell="{ row }">
              <span :class="row.original.refundedMinor ? '' : 'text-muted'">{{ negativeMinor(row.original.refundedMinor) }}</span>
            </template>

            <template #name-footer>
              Totals for {{ data.totals.items }} {{ data.totals.items === 1 ? 'item' : 'items' }}
            </template>
            <template #quantity-footer>
              <span class="block text-right tabular-nums">{{ data.totals.quantity }}</span>
            </template>
            <template #salesMinor-footer>
              <span class="block text-right tabular-nums">{{ formatMinor(data.totals.salesMinor) }}</span>
            </template>
            <template #refundedMinor-footer>
              <span class="block text-right tabular-nums">{{ negativeMinor(data.totals.refundedMinor) }}</span>
            </template>
          </UTable>

          <p class="text-sm text-muted print:hidden">
            {{ range }} · The CSV includes all matching items.
          </p>
          <ListPagination
            v-model:page="page"
            v-model:page-size="pageSize"
            :total="data.total"
            class="print:hidden"
          />
        </template>

        <ReportDefinitions kind="items" />
      </template>
    </template>
  </UDashboardPanel>
</template>
