<script setup lang="ts">
/**
 * The report's header on paper only (D111): cafe, branch, report, the period with its business day
 * and zone, when the figures were read, and who printed it when. The screen shows the same in
 * `ReportHeader`.
 */
import { useEventListener } from '@vueuse/core'
import type { ReportContext } from '#shared/contracts/reports'
import { useAuth } from '~/features/auth'
import { BUSINESS_DAY_TEXT, stampIn } from '../utils/display'
import { periodLabel } from '../utils/period'

const props = defineProps<{ title: string, report: ReportContext }>()

const { user } = useAuth()
const { name: cafeName } = useCafe()
// Read when printing starts, not when the page opened.
const printedAt = ref(new Date().toISOString())
useEventListener('beforeprint', () => {
  printedAt.value = new Date().toISOString()
})

const zone = computed(() => props.report.branch.timeZone)
</script>

<template>
  <header class="mb-4 hidden border-b border-default pb-3 print:block">
    <p class="text-lg font-semibold text-highlighted">
      {{ cafeName }} · {{ report.branch.name }} · {{ title }}
    </p>
    <p class="text-sm">
      {{ periodLabel(report.period) }} ({{ BUSINESS_DAY_TEXT }}, {{ zone }})
    </p>
    <p class="text-xs text-muted">
      Figures as of {{ stampIn(report.asOf, zone) }} · Printed {{ stampIn(printedAt, zone) }}<template v-if="user">
        by {{ user.name || user.email }}
      </template>
    </p>
  </header>
</template>
