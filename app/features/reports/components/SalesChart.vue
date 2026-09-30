<script setup lang="ts">
/**
 * Paid sales by hour or by day (D111): plain bars with dollar gridlines, no chart library (at most
 * 24 or 93 bars). Hours are trimmed to the first and last hour with sales. Screen readers get the
 * same numbers as a table.
 */
import type { ReportSummary } from '#shared/contracts/reports'
import { chartPoints, niceScale } from '../utils/chart'
import { dayLabel, hourLabel } from '../utils/display'

const props = defineProps<{ trend: ReportSummary['trend'] }>()

const points = computed(() => chartPoints(props.trend))
const scale = computed(() => niceScale(Math.max(0, ...points.value.map(p => p.salesMinor))))
const ticks = computed(() => {
  const list: number[] = []
  for (let value = scale.value.top; value >= 0; value -= scale.value.step) list.push(value)
  return list
})
const label = (key: string) => (props.trend.unit === 'hour' ? hourLabel(key) : dayLabel(key))
/** Every bar is labelled up to 16 bars; beyond that every nth, so labels never overlap. */
const labelEvery = computed(() => Math.max(1, Math.ceil(points.value.length / 16)))
const axis = (minor: number) => formatMinor(minor).replace(/\.00$/, '')
</script>

<template>
  <div>
    <div
      class="flex gap-2"
      aria-hidden="true"
    >
      <!-- The dollar axis -->
      <div class="flex h-48 flex-col justify-between text-right text-xs text-muted tabular-nums print:h-36">
        <span
          v-for="tick in ticks"
          :key="tick"
          class="-my-2 leading-4"
        >{{ axis(tick) }}</span>
      </div>
      <div class="min-w-0 flex-1">
        <div class="relative h-48 print:h-36">
          <div
            v-for="tick in ticks"
            :key="tick"
            class="absolute inset-x-0 border-t border-default"
            :style="{ top: `${100 - (tick / scale.top) * 100}%` }"
          />
          <div class="absolute inset-0 flex items-end gap-px sm:gap-1">
            <div
              v-for="point in points"
              :key="point.key"
              class="flex h-full min-w-0 flex-1 items-end justify-center"
              :title="`${label(point.key)}: ${formatMinor(point.salesMinor)} · ${point.orders} ${point.orders === 1 ? 'order' : 'orders'}`"
            >
              <div
                class="w-full max-w-12 rounded-t-sm bg-primary print:bg-neutral-700"
                :style="{ height: `${(point.salesMinor / scale.top) * 100}%` }"
              />
            </div>
          </div>
        </div>
        <div class="mt-1 flex gap-px sm:gap-1">
          <span
            v-for="(point, index) in points"
            :key="point.key"
            class="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-xs text-muted"
          >{{ index % labelEvery === 0 ? label(point.key) : '' }}</span>
        </div>
      </div>
    </div>

    <table class="sr-only">
      <caption>{{ trend.unit === 'hour' ? 'Paid sales by hour' : 'Paid sales by day' }}</caption>
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
