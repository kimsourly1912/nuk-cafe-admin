<script setup lang="ts">
/**
 * How a report's numbers are counted, short (the full definitions: docs/plans/reports.md, D110).
 * On screen at the bottom of the page and on paper, so a printed report explains itself.
 */
type Kind = 'summary' | 'items' | 'orders'
defineProps<{ kind: Kind }>()

const LINES: Record<Kind, string[]> = {
  summary: [
    'Paid sales: payments taken in this period, whenever the order was placed.',
    'Refunds: money returned in this period for cancelled paid orders. Net sales = paid sales − refunds.',
    'Average order: paid sales ÷ paid orders.',
    'Orders placed and cancelled orders count on the day the order was placed.',
    'A business day runs from 4:00 AM to 4:00 AM in the branch\'s time zone.',
  ],
  items: [
    'Quantity and paid sales: items in orders paid in this period, with their add-ons.',
    'Refunded: items in orders whose money was returned in this period.',
    'A business day runs from 4:00 AM to 4:00 AM in the branch\'s time zone.',
  ],
  orders: [
    'Orders placed in this period (by the day they were placed), with their payment and progress now.',
    'A business day runs from 4:00 AM to 4:00 AM in the branch\'s time zone.',
  ],
}
</script>

<template>
  <section
    aria-labelledby="report-definitions"
    class="break-inside-avoid rounded-md border border-default p-3 text-xs text-muted"
  >
    <h2
      id="report-definitions"
      class="mb-1 font-semibold text-toned"
    >
      How these are counted
    </h2>
    <ul class="list-disc space-y-0.5 ps-4">
      <li
        v-for="line in LINES[kind]"
        :key="line"
      >
        {{ line }}
      </li>
    </ul>
  </section>
</template>
