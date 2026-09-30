<script setup lang="ts">
/**
 * The report's period (D111): presets (Today, Yesterday, Last 7 days, This month) and a calendar
 * range, at most `REPORT_MAX_DAYS` days, never after today. Dates are business dates in the
 * branch's zone; `today` comes from the server.
 */
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { REPORT_MAX_DAYS } from '#shared/contracts/reports'
import type { Period } from '../utils/period'
import { periodButtonLabel, periodLabel, PRESETS, presetOf, presetPeriod } from '../utils/period'

const props = defineProps<{ period: Period, today: string }>()
const emit = defineEmits<{ change: [period: Period] }>()

const open = ref(false)
/** The calendar's range while choosing: the first click sets `start`, the second `end`. */
const range = shallowRef<{ start: DateValue | undefined, end: DateValue | undefined }>({ start: undefined, end: undefined })
watch(open, (isOpen) => {
  if (isOpen) range.value = { start: parseDate(props.period.from), end: parseDate(props.period.to) }
})

const active = computed(() => presetOf(props.period, props.today))
const maxValue = computed(() => parseDate(props.today))

function choose(next: Period) {
  open.value = false
  if (next.from !== props.period.from || next.to !== props.period.to) emit('change', next)
}

// A range is chosen with two clicks; the second one applies it.
watch(range, (value) => {
  if (!open.value || !value.start || !value.end) return
  const next = { from: value.start.toString(), to: value.end.toString() }
  if (next.from !== props.period.from || next.to !== props.period.to) choose(next)
})
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'start' }"
  >
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-calendar"
      trailing-icon="i-lucide-chevron-down"
      :label="periodButtonLabel(period, today)"
      :aria-label="`Period: ${periodLabel(period)}`"
    />

    <template #content>
      <div class="flex flex-col sm:flex-row">
        <ul
          aria-label="Quick periods"
          class="flex flex-wrap gap-1 border-b border-default p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-e sm:border-b-0"
        >
          <li
            v-for="preset in PRESETS"
            :key="preset.id"
          >
            <UButton
              :label="preset.label"
              color="neutral"
              :variant="active === preset.id ? 'soft' : 'ghost'"
              :aria-pressed="active === preset.id"
              class="w-full"
              @click="choose(presetPeriod(preset.id, today))"
            />
          </li>
        </ul>
        <div class="p-2">
          <UCalendar
            v-model="range"
            range
            :max-value="maxValue"
            :maximum-days="REPORT_MAX_DAYS"
            aria-label="Custom range"
          />
          <p class="px-2 pt-1 text-xs text-muted">
            Choose the first and last day · at most {{ REPORT_MAX_DAYS }} days
          </p>
        </div>
      </div>
    </template>
  </UPopover>
</template>
