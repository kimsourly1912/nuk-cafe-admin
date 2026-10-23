<script setup lang="ts">
/**
 * A manager's reports on the counter (`/counter/<branchId>/reports/<report>`, D198): the admin's
 * report pages for the branch in the path, on the counter's API (`report: ['read']` there). View
 * and print; no CSV or Telegram. Staff who open the address get the server's refusal.
 */
import type { ReportPage } from '../composables/useReportSurface'
import { provideCounterReportSurface } from '../composables/useReportSurface'
import ItemSalesPage from './ItemSalesPage.vue'
import OrderHistoryPage from './OrderHistoryPage.vue'
import SummaryPage from './SummaryPage.vue'

const props = defineProps<{ report: ReportPage }>()

provideCounterReportSurface(String(useRoute().params.branchId ?? ''))
const pages = { summary: SummaryPage, items: ItemSalesPage, orders: OrderHistoryPage }

useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <component :is="pages[props.report]" />
</template>
