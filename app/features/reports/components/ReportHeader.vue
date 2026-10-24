<script setup lang="ts">
/**
 * Every report page's header (D111, the owner's frames): the title with Download CSV, Print and,
 * where Telegram is set up, Send to Telegram (one Actions menu on phones), then the period, the branch when there are several, and what the numbers
 * mean: "Riverside · Asia/Phnom_Penh · business day 4:00 AM – 4:00 AM · Updated 2:35 PM". None of
 * it prints: the print header (`ReportPrintHeader`) says the same on paper.
 *
 * On the counter (a manager's reports, D198): Back to queue instead of the sidebar, Print only (no
 * CSV or Telegram), and the three reports as tabs (the admin has them in its sidebar).
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ReportBranch } from '#shared/contracts/reports'
import type { ReportPage } from '../composables/useReportSurface'
import { useReportSurface } from '../composables/useReportSurface'
import { BUSINESS_DAY_TEXT, clockIn } from '../utils/display'
import type { Period } from '../utils/period'
import ReportPeriodPicker from './ReportPeriodPicker.vue'

const props = defineProps<{
  title: string
  report: ReportPage
  branches: ReportBranch[]
  branch?: ReportBranch
  period?: Period
  /** When the shown numbers were read (`asOf`). */
  asOf?: string
  refreshing?: boolean
  downloading?: boolean
  /** Send to Telegram (Summary and Sales by item, where Telegram is set up; D112). */
  canSend?: boolean
}>()
const emit = defineEmits<{ period: [period: Period], branch: [id: string], download: [], print: [], send: [] }>()

const { isCompact } = useLayoutContext()
const surface = useReportSurface()
const tenantPath = useTenantPath()
const route = useRoute()

const reportTabs: { label: string, value: ReportPage }[] = [
  { label: 'Summary', value: 'summary' },
  { label: 'Sales by item', value: 'items' },
  { label: 'Order history', value: 'orders' },
]
// Another report keeps the period (the branch is the counter's).
function openReport(report: ReportPage) {
  const { from, to } = route.query
  navigateTo({ path: surface.page(report), query: { from, to } })
}

const branchItems = computed(() => props.branches.map(b => ({ label: b.name, value: b.id })))

const actions = computed<DropdownMenuItem[]>(() => [
  ...(surface.exports ? [{ label: 'Download CSV', icon: 'i-lucide-download', disabled: props.downloading || !props.branch, onSelect: () => emit('download') }] : []),
  { label: 'Print', icon: 'i-lucide-printer', disabled: !props.branch, onSelect: () => emit('print') },
  ...(props.canSend && surface.exports ? [{ label: 'Send to Telegram', icon: 'i-lucide-send', disabled: !props.branch, onSelect: () => emit('send') }] : []),
])
</script>

<template>
  <UDashboardNavbar
    :title="title"
    :toggle="!surface.counterBranchId"
    class="print:hidden"
  >
    <template #leading>
      <UButton
        v-if="surface.counterBranchId"
        :to="tenantPath(`/counter/${surface.counterBranchId}`)"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        aria-label="Back to queue"
      />
      <UDashboardSidebarCollapse v-else />
    </template>
    <template #right>
      <!-- The counter has no sidebar to hold it (the admin's is there). -->
      <UColorModeButton v-if="surface.counterBranchId" />
      <UDropdownMenu
        v-if="isCompact"
        :items="actions"
        :content="{ align: 'end' }"
      >
        <UButton
          icon="i-lucide-ellipsis"
          color="neutral"
          variant="outline"
          aria-label="Actions"
          :loading="downloading"
        />
      </UDropdownMenu>
      <template v-else>
        <UButton
          v-if="surface.exports"
          label="Download CSV"
          icon="i-lucide-download"
          color="neutral"
          variant="outline"
          :loading="downloading"
          :disabled="!branch"
          @click="emit('download')"
        />
        <UButton
          label="Print"
          icon="i-lucide-printer"
          color="neutral"
          variant="outline"
          :disabled="!branch"
          @click="emit('print')"
        />
        <UButton
          v-if="canSend && surface.exports"
          label="Send to Telegram"
          icon="i-lucide-send"
          color="neutral"
          variant="outline"
          :disabled="!branch"
          @click="emit('send')"
        />
      </template>
    </template>
  </UDashboardNavbar>

  <UDashboardToolbar
    v-if="surface.counterBranchId"
    class="print:hidden"
  >
    <ToolbarTabs
      :model-value="report"
      :items="reportTabs"
      aria-label="Reports"
      @update:model-value="openReport"
    />
  </UDashboardToolbar>

  <UDashboardToolbar
    class="print:hidden"
    :ui="{ root: 'h-auto min-h-(--ui-header-height) py-2', left: 'flex-wrap gap-x-3 gap-y-1' }"
  >
    <template #left>
      <USkeleton
        v-if="!branch || !period"
        class="h-8 w-40"
      />
      <template v-else>
        <ReportPeriodPicker
          :period="period"
          :today="branch.today"
          @change="emit('period', $event)"
        />
        <RecordSelect
          v-if="branches.length > 1"
          :model-value="branch.id"
          :items="branchItems"
          noun="branches"
          aria-label="Branch"
          class="w-44"
          @update:model-value="emit('branch', String($event))"
        />
        <p class="text-xs text-muted">
          {{ branch.name }} · {{ branch.timeZone }} · {{ BUSINESS_DAY_TEXT }}<template v-if="asOf">
            · Updated {{ clockIn(asOf, branch.timeZone) }}
          </template>
        </p>
        <UIcon
          v-if="refreshing"
          name="i-lucide-loader-circle"
          class="size-4 animate-spin text-muted"
          aria-label="Updating…"
        />
      </template>
    </template>
  </UDashboardToolbar>
</template>
