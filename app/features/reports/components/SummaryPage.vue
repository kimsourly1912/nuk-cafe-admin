<script setup lang="ts">
/**
 * Reports → Summary (`/admin/reports/summary`, step 8.1b, D111, the owner's frames): how a period
 * went at one branch. Paid sales, paid orders, average and refunds with net sales below; paid
 * sales by hour (one day) or by day; payments by method; current orders (only when the period
 * includes today: they're live); best sellers; orders cancelled without payment. Every number's
 * definition is in docs/plans/reports.md (D110) and, short, at the bottom of the page and the print.
 */
import type { ReportSummary } from '#shared/contracts/reports'
import { queryText, useReportDestinations, useReportDownload, useReportScope, useReportSummary } from '../composables/useReports'
import { changeText, formatRiel, METHOD_LABELS, negativeMinor } from '../utils/display'
import { periodButtonLabel, periodLabel, previousLabel } from '../utils/period'
import ReportDefinitions from './ReportDefinitions.vue'
import SendToTelegramModal from './SendToTelegramModal.vue'
import ReportHeader from './ReportHeader.vue'
import ReportPrintHeader from './ReportPrintHeader.vue'
import SalesChart from './SalesChart.vue'

const { branches, branch, period, scope, setPeriod, setBranch } = useReportScope()
const summary = useReportSummary(scope)
const download = useReportDownload()

const data = computed(() => summary.data.value ?? undefined)
const error = computed(() => branches.error.value ?? summary.error.value)
const retry = () => (branches.error.value ? branches.refresh() : summary.refresh())

const change = computed(() => data.value && changeText(data.value.paid.salesMinor, data.value.previousPaidSalesMinor))

function downloadCsv() {
  if (!scope.value || !branch.value) return
  download.execute({ kind: 'summary', branchName: branch.value.name, query: scope.value })
}

const printPage = () => window.print()

// Send to Telegram, where it's set up (D112): the message is built on the server from this query.
const telegram = useReportDestinations()
const sendModal = useOverlay().create(SendToTelegramModal)
function openSend() {
  if (!scope.value || !period.value || !branch.value) return
  const label = periodButtonLabel(period.value, branch.value.today)
  const dates = periodLabel(period.value)
  sendModal.open({ kind: 'summary', title: `Summary · ${label === dates ? dates : `${label} (${dates})`}`, query: queryText(scope.value) })
}

const paymentsTotal = (report: ReportSummary) => ({
  orders: report.payments.reduce((sum, p) => sum + p.orders, 0),
  amountMinor: report.payments.reduce((sum, p) => sum + p.amountMinor, 0),
})
</script>

<template>
  <UDashboardPanel
    id="report-summary"
    :ui="{ root: 'print:min-h-0', body: 'print:overflow-visible print:p-0' }"
  >
    <template #header>
      <ReportHeader
        title="Summary"
        :branches="branches.data.value ?? []"
        :branch="branch"
        :period="period"
        :as-of="data?.asOf"
        :refreshing="summary.refreshing.value"
        :downloading="download.isPending('summary')"
        :can-send="telegram.data.value?.enabled"
        @period="setPeriod"
        @branch="setBranch"
        @download="downloadCsv"
        @print="printPage"
        @send="openSend"
      />
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Couldn't load the report"
        @retry="retry()"
      />

      <div
        v-else-if="!data"
        class="grid grid-cols-2 gap-3 lg:grid-cols-4"
        aria-busy="true"
        aria-label="Loading the report…"
      >
        <USkeleton
          v-for="n in 4"
          :key="n"
          class="h-24"
        />
        <USkeleton class="col-span-full h-64" />
      </div>

      <!-- One block: the body is a scrolling flex column, where cards (overflow hidden) would shrink -->
      <div
        v-else
        class="space-y-4 sm:space-y-6"
      >
        <ReportPrintHeader
          title="Summary"
          :report="data"
        />

        <section aria-label="Sales">
          <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4">
            <UCard :ui="{ body: 'p-4 sm:p-4' }">
              <dt class="text-sm text-muted">
                Paid sales
              </dt>
              <dd class="mt-1 text-2xl font-semibold text-highlighted tabular-nums">
                {{ formatMinor(data.paid.salesMinor) }}
              </dd>
              <dd
                v-if="change && period && branch"
                class="mt-1 text-xs"
                :class="change.up ? 'text-success' : 'text-error'"
              >
                {{ change.text }} <span class="text-muted">{{ previousLabel(period, branch.today) }}</span>
              </dd>
            </UCard>
            <UCard :ui="{ body: 'p-4 sm:p-4' }">
              <dt class="text-sm text-muted">
                Paid orders
              </dt>
              <dd class="mt-1 text-2xl font-semibold text-highlighted tabular-nums">
                {{ data.paid.orders.toLocaleString('en-US') }}
              </dd>
            </UCard>
            <UCard :ui="{ body: 'p-4 sm:p-4' }">
              <dt class="text-sm text-muted">
                Average order
              </dt>
              <dd class="mt-1 text-2xl font-semibold text-highlighted tabular-nums">
                {{ formatMinor(data.paid.averageMinor) }}
              </dd>
            </UCard>
            <UCard :ui="{ body: 'p-4 sm:p-4' }">
              <dt class="text-sm text-muted">
                Refunds
              </dt>
              <dd class="mt-1 text-2xl font-semibold text-highlighted tabular-nums">
                {{ negativeMinor(data.refunds.amountMinor) }}
                <span
                  v-if="data.refunds.orders"
                  class="text-base font-normal text-muted"
                >({{ data.refunds.orders }})</span>
              </dd>
            </UCard>
          </dl>
          <p class="mt-2 text-sm text-muted">
            Net sales <span class="font-semibold text-highlighted tabular-nums">{{ formatMinor(data.netSalesMinor) }}</span>
            <span class="ms-1">(paid sales − refunds)</span>
          </p>
        </section>

        <UCard
          as="section"
          aria-labelledby="sales-trend"
          class="break-inside-avoid"
        >
          <template #header>
            <h2
              id="sales-trend"
              class="font-semibold text-highlighted"
            >
              {{ data.trend.unit === 'hour' ? 'Paid sales by hour' : 'Paid sales by day' }}
            </h2>
          </template>
          <SalesChart
            v-if="data.paid.orders"
            :trend="data.trend"
          />
          <p
            v-else
            class="py-8 text-center text-sm text-muted"
          >
            No paid orders in this period.
          </p>
        </UCard>

        <div class="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
          <UCard
            as="section"
            aria-labelledby="payments"
            class="break-inside-avoid"
            :ui="{ body: 'p-0 sm:p-0' }"
          >
            <template #header>
              <h2
                id="payments"
                class="font-semibold text-highlighted"
              >
                Payments
              </h2>
            </template>
            <table class="w-full text-sm">
              <thead class="sr-only">
                <tr>
                  <th scope="col">
                    Method
                  </th>
                  <th scope="col">
                    Orders
                  </th>
                  <th scope="col">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr
                  v-for="payment in data.payments"
                  :key="payment.method"
                >
                  <th
                    scope="row"
                    class="px-4 py-3 text-left font-medium text-highlighted"
                  >
                    {{ METHOD_LABELS[payment.method] }}
                  </th>
                  <td class="px-4 py-3 text-right text-muted tabular-nums">
                    {{ payment.orders }} {{ payment.orders === 1 ? 'order' : 'orders' }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    <template v-if="payment.amountKhr !== null && payment.orders">
                      {{ formatRiel(payment.amountKhr) }}
                      <span class="block text-xs text-muted">= {{ formatMinor(payment.amountMinor) }}</span>
                    </template>
                    <template v-else>
                      {{ formatMinor(payment.amountMinor) }}
                    </template>
                  </td>
                </tr>
              </tbody>
              <tfoot class="border-t border-default font-semibold text-highlighted">
                <tr>
                  <th
                    scope="row"
                    class="px-4 py-3 text-left"
                  >
                    Total
                  </th>
                  <td class="px-4 py-3 text-right tabular-nums">
                    {{ paymentsTotal(data).orders }} {{ paymentsTotal(data).orders === 1 ? 'order' : 'orders' }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    {{ formatMinor(paymentsTotal(data).amountMinor) }}
                  </td>
                </tr>
              </tfoot>
            </table>
          </UCard>

          <UCard
            v-if="data.current"
            as="section"
            aria-labelledby="current-orders"
            class="break-inside-avoid"
          >
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <h2
                  id="current-orders"
                  class="font-semibold text-highlighted"
                >
                  Current orders
                </h2>
                <UBadge
                  label="Live"
                  color="success"
                  variant="subtle"
                  icon="i-lucide-radio"
                />
              </div>
            </template>
            <dl class="grid grid-cols-3 gap-3 text-center">
              <div class="rounded-md bg-elevated/50 p-3">
                <dt class="text-xs text-muted">
                  Waiting for payment
                </dt>
                <dd class="mt-1 text-2xl font-semibold text-highlighted tabular-nums">
                  {{ data.current.awaitingPayment }}
                </dd>
              </div>
              <div class="rounded-md bg-elevated/50 p-3">
                <dt class="text-xs text-muted">
                  Preparing
                </dt>
                <dd class="mt-1 text-2xl font-semibold text-highlighted tabular-nums">
                  {{ data.current.preparing }}
                </dd>
              </div>
              <div class="rounded-md bg-elevated/50 p-3">
                <dt class="text-xs text-muted">
                  Ready
                </dt>
                <dd class="mt-1 text-2xl font-semibold text-highlighted tabular-nums">
                  {{ data.current.ready }}
                </dd>
              </div>
            </dl>
            <p class="mt-3 text-xs text-muted">
              Right now, as of the time above. {{ data.ordersPlaced.toLocaleString('en-US') }} {{ data.ordersPlaced === 1 ? 'order' : 'orders' }} placed in this period.
            </p>
          </UCard>

          <UCard
            v-else
            as="section"
            aria-labelledby="orders-placed"
            class="break-inside-avoid"
          >
            <template #header>
              <h2
                id="orders-placed"
                class="font-semibold text-highlighted"
              >
                Orders placed in this period
              </h2>
            </template>
            <p class="text-2xl font-semibold text-highlighted tabular-nums">
              {{ data.ordersPlaced.toLocaleString('en-US') }}
            </p>
            <p class="mt-1 text-xs text-muted">
              Every order placed, paid or not.
            </p>
          </UCard>
        </div>

        <div class="grid gap-4 lg:grid-cols-3 print:grid-cols-3">
          <UCard
            as="section"
            aria-labelledby="best-sellers"
            class="break-inside-avoid lg:col-span-2 print:col-span-2"
            :ui="{ body: 'p-0 sm:p-0' }"
          >
            <template #header>
              <div class="flex items-center justify-between gap-2">
                <h2
                  id="best-sellers"
                  class="font-semibold text-highlighted"
                >
                  Best sellers
                </h2>
                <UButton
                  v-if="data.bestSellers.length"
                  label="Sales by item"
                  trailing-icon="i-lucide-arrow-right"
                  color="neutral"
                  variant="link"
                  :to="{ path: '/admin/reports/items', query: { from: data.period.from, to: data.period.to } }"
                  class="print:hidden"
                />
              </div>
            </template>
            <table
              v-if="data.bestSellers.length"
              class="w-full text-sm"
            >
              <thead class="text-xs text-muted">
                <tr>
                  <th
                    scope="col"
                    class="px-4 py-2 text-left font-medium"
                  >
                    Item
                  </th>
                  <th
                    scope="col"
                    class="px-4 py-2 text-right font-medium"
                  >
                    Sold
                  </th>
                  <th
                    scope="col"
                    class="px-4 py-2 text-right font-medium"
                  >
                    Paid sales
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr
                  v-for="(item, index) in data.bestSellers"
                  :key="item.itemId"
                >
                  <th
                    scope="row"
                    class="px-4 py-2.5 text-left font-medium text-highlighted"
                  >
                    <span class="me-2 text-muted tabular-nums">{{ index + 1 }}</span>{{ item.name }}
                  </th>
                  <td class="px-4 py-2.5 text-right tabular-nums">
                    {{ item.quantity }}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums">
                    {{ formatMinor(item.salesMinor) }}
                  </td>
                </tr>
              </tbody>
            </table>
            <p
              v-else
              class="p-4 text-sm text-muted"
            >
              Nothing sold in this period.
            </p>
          </UCard>

          <UCard
            as="section"
            aria-labelledby="cancelled-unpaid"
            class="break-inside-avoid"
          >
            <template #header>
              <h2
                id="cancelled-unpaid"
                class="font-semibold text-highlighted"
              >
                Cancelled, not paid
              </h2>
            </template>
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between gap-2">
                <dt>By the customer</dt>
                <dd class="font-medium text-highlighted tabular-nums">
                  {{ data.cancelledUnpaid.customer }}
                </dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt>By the cafe</dt>
                <dd class="font-medium text-highlighted tabular-nums">
                  {{ data.cancelledUnpaid.cafe }}
                </dd>
              </div>
              <div class="flex justify-between gap-2">
                <dt>Expired unpaid</dt>
                <dd class="font-medium text-highlighted tabular-nums">
                  {{ data.cancelledUnpaid.system }}
                </dd>
              </div>
            </dl>
            <p class="mt-3 text-xs text-muted">
              Orders placed in this period and cancelled before payment. Expired: not paid within 30 minutes.
            </p>
          </UCard>
        </div>

        <ReportDefinitions kind="summary" />
      </div>
    </template>
  </UDashboardPanel>
</template>
