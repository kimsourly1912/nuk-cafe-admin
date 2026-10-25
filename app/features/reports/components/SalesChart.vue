<script setup lang="ts">
/**
 * Paid sales by hour or by day (D111, D207): Nuxt UI's `UChart` with our own TanStack Charts
 * definition, because the bars are keyed by hour or date ("Mon 1" repeats across months) and labelled
 * through the tick format, which UChart's generated bar chart can't do. Hours are trimmed to the
 * first and last hour with sales. Screen readers also get the same numbers as a table.
 */
import { barY, defineChart, ruleY } from '@tanstack/charts'
import { scaleBand } from '@tanstack/charts/scales/band'
import { scaleLinear } from '@tanstack/charts/scales/linear'
import type { ReportSummary, TrendPoint } from '#shared/contracts/reports'
import { chartPoints } from '../utils/chart'
import { dayLabel, hourLabel } from '../utils/display'

const props = defineProps<{ trend: ReportSummary['trend'] }>()

const points = computed(() => chartPoints(props.trend))
const label = (key: string) => (props.trend.unit === 'hour' ? hourLabel(key) : dayLabel(key))
const axis = (minor: number) => formatMinor(minor).replace(/\.00$/, '')
const title = computed(() => (props.trend.unit === 'hour' ? 'Paid sales by hour' : 'Paid sales by day'))

const definition = computed(() => defineChart({
  marks: [
    barY(points.value, { x: 'key', y: 'salesMinor', fill: 'var(--ui-primary)', inset: 1, maxThickness: 48, radius: { end: 4 } }),
    ruleY([0]),
  ],
  scales: {
    x: { scale: () => scaleBand().padding(0.2), axis: { ticks: { format: (key: string) => label(key) } } },
    y: { scale: scaleLinear, nice: true, grid: true, axis: { ticks: { count: 4, format: axis } } },
  },
  // The default only focuses a bar within 48 pixels of the pointer; any spot over the chart should.
  maxFocusDistance: Number.POSITIVE_INFINITY,
}))
</script>

<template>
  <div>
    <UChart
      :definition="definition"
      :aria-label="title"
      :height="192"
    >
      <template #tooltip="{ primaryPoint }">
        <p class="font-medium text-highlighted">
          {{ label((primaryPoint.datum as TrendPoint).key) }}
        </p>
        <p class="tabular-nums">
          <span class="font-medium text-highlighted">{{ formatMinor((primaryPoint.datum as TrendPoint).salesMinor) }}</span>
          · {{ (primaryPoint.datum as TrendPoint).orders }} {{ (primaryPoint.datum as TrendPoint).orders === 1 ? 'order' : 'orders' }}
        </p>
      </template>
    </UChart>

    <table class="sr-only">
      <caption>{{ title }}</caption>
      <thead>
        <tr>
          <th scope="col">
            {{ trend.unit === 'hour' ? 'Hour' : 'Day' }}
          </th>
          <th scope="col">
            Paid sales
          </th>
          <th scope="col">
            Orders
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="point in points"
          :key="point.key"
        >
          <th scope="row">
            {{ label(point.key) }}
          </th>
          <td>{{ formatMinor(point.salesMinor) }}</td>
          <td>{{ point.orders }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
