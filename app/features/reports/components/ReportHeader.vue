<script setup lang="ts">
/**
 * Every report page's header (D111, the owner's frames): the title with Download CSV, Print and,
 * where Telegram is set up, Send to Telegram (one Actions menu on phones), then the period, the branch when there are several, and what the numbers
 * mean: "Riverside · Asia/Phnom_Penh · business day 4:00 AM – 4:00 AM · Updated 2:35 PM". None of
 * it prints: the print header (`ReportPrintHeader`) says the same on paper.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { ReportBranch } from '#shared/contracts/reports'
import { BUSINESS_DAY_TEXT, clockIn } from '../utils/display'
import type { Period } from '../utils/period'
import ReportPeriodPicker from './ReportPeriodPicker.vue'

const props = defineProps<{
  title: string
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

const branchItems = computed(() => props.branches.map(b => ({ label: b.name, value: b.id })))

const actions = computed<DropdownMenuItem[]>(() => [
  { label: 'Download CSV', icon: 'i-lucide-download', disabled: props.downloading || !props.branch, onSelect: () => emit('download') },
  { label: 'Print', icon: 'i-lucide-printer', disabled: !props.branch, onSelect: () => emit('print') },
  ...(props.canSend ? [{ label: 'Send to Telegram', icon: 'i-lucide-send', disabled: !props.branch, onSelect: () => emit('send') }] : []),
])
</script>

<template>
  <UDashboardNavbar
    :title="title"
    class="print:hidden"
  >
    <template #leading>
      <UDashboardSidebarCollapse />
    </template>
    <template #right>
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
          v-if="canSend"
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
