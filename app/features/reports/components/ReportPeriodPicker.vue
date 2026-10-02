<script setup lang="ts">
/**
 * The report's period (D111, reworked in D126): presets (Today, Yesterday, Last 7 days, This month)
 * and a calendar range, at most `REPORT_MAX_DAYS` days, never after today. Dates are business dates
 * in the branch's zone; `today` comes from the server.
 *
 * - From `sm`: a popover, presets beside the calendar (two months from `lg`). The first click starts the range, the hover
 *   highlights up to the pointer, the second click applies it. Days that would make the range too
 *   long are disabled while choosing (Reka's own `maximumDays` lit the whole allowed window instead).
 * - Phones: a bottom sheet. Presets as large rows (a tap applies); Custom range opens one month with
 *   a From / To line, and nothing applies until Apply, so a wrong tap is easy to fix.
 */
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'
import { REPORT_MAX_DAYS } from '#shared/contracts/reports'
import type { Period } from '../utils/period'
import { beyondRangeLimit, dateLabel, periodButtonLabel, periodLabel, PRESETS, presetOf, presetPeriod } from '../utils/period'

const props = defineProps<{ period: Period, today: string }>()
const emit = defineEmits<{ change: [period: Period] }>()

const { isCompact, isExpanded } = useLayoutContext()
const open = ref(false)
/** Phones: the presets, or the calendar for a custom range. */
const step = ref<'presets' | 'custom'>('presets')

type Range = { start: DateValue | undefined, end: DateValue | undefined }
/** The calendar's range while choosing: the first click sets `start`, the second `end`. */
const range = shallowRef<Range>({ start: undefined, end: undefined })
/** The month the calendar shows first: with two months, the one before the period's end, so today's month is on the right. */
const view = shallowRef<DateValue>(parseDate(props.today))
watch(open, (isOpen) => {
  if (!isOpen) return
  range.value = { start: parseDate(props.period.from), end: parseDate(props.period.to) }
  const end = parseDate(props.period.to)
  view.value = isExpanded.value ? end.subtract({ months: 1 }) : end
  step.value = 'presets'
})

const active = computed(() => presetOf(props.period, props.today))
const maxValue = computed(() => parseDate(props.today))
/** While a range is half chosen, days too far from its first day can't end it. */
const isDateDisabled = (day: DateValue) => {
  const { start, end } = range.value
  return !!start && !end && beyondRangeLimit(start.toString(), day.toString())
}

function choose(next: Period) {
  open.value = false
  if (next.from !== props.period.from || next.to !== props.period.to) emit('change', next)
}

function chooseRange() {
  const { start, end } = range.value
  if (start && end) choose({ from: start.toString(), to: end.toString() })
}

// From `sm` the second click applies the range; on phones, Apply does. Opening the picker sets the
// range to the current period, which isn't a choice.
watch(range, (value) => {
  if (!open.value || isCompact.value || !value.start || !value.end) return
  if (value.start.toString() !== props.period.from || value.end.toString() !== props.period.to) chooseRange()
})

function startCustom() {
  range.value = { start: undefined, end: undefined }
  // The branch's month, not the browser's: the business date comes from the server.
  view.value = parseDate(props.today)
  step.value = 'custom'
}
</script>

<template>
  <AppDrawer
    v-if="isCompact"
    v-model:open="open"
    :title="step === 'presets' ? 'Period' : 'Custom range'"
    :description="step === 'presets' ? 'Choose the days to report on.' : `Choose the first and last day, at most ${REPORT_MAX_DAYS} days.`"
    :ui="{ body: 'pb-2', footer: 'flex-row gap-2' }"
  >
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-calendar"
      trailing-icon="i-lucide-chevron-down"
      :label="periodButtonLabel(period, today)"
      :aria-label="`Period: ${periodLabel(period)}`"
    />

    <template #body>
      <ul
        v-if="step === 'presets'"
        aria-label="Quick periods"
        class="divide-y divide-default"
      >
        <li
          v-for="preset in PRESETS"
          :key="preset.id"
        >
          <UButton
            :label="preset.label"
            color="neutral"
            variant="ghost"
            size="lg"
            block
            :trailing-icon="active === preset.id ? 'i-lucide-check' : undefined"
            :aria-pressed="active === preset.id"
            class="justify-between rounded-none px-1 py-3"
            @click="choose(presetPeriod(preset.id, today))"
          />
        </li>
        <li>
          <UButton
            label="Custom range"
            color="neutral"
            variant="ghost"
            size="lg"
            block
            trailing-icon="i-lucide-chevron-right"
            :aria-pressed="!active"
            class="justify-between rounded-none px-1 py-3"
            @click="startCustom"
          />
        </li>
      </ul>

      <div
        v-else
        class="space-y-3"
      >
        <p
          class="flex gap-2 rounded-md bg-elevated/50 px-3 py-2 text-sm"
          aria-live="polite"
        >
          <span><span class="text-muted">From</span> {{ range.start ? dateLabel(range.start.toString()) : 'choose a day' }}</span>
          <span
            v-if="range.start"
            class="text-muted"
          >·</span>
          <span v-if="range.start"><span class="text-muted">To</span> {{ range.end ? dateLabel(range.end.toString()) : 'choose a day' }}</span>
        </p>
        <UCalendar
          v-model="range"
          v-model:placeholder="view"
          range
          size="lg"
          :max-value="maxValue"
          :is-date-disabled="isDateDisabled"
          aria-label="Custom range"
          class="w-full"
        />
      </div>
    </template>

    <template
      v-if="step === 'custom'"
      #footer
    >
      <UButton
        label="Back"
        color="neutral"
        variant="outline"
        icon="i-lucide-chevron-left"
        @click="step = 'presets'"
      />
      <UButton
        label="Apply"
        class="flex-1 justify-center"
        :disabled="!range.start || !range.end"
        @click="chooseRange"
      />
    </template>
  </AppDrawer>

  <UPopover
    v-else
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
      <div class="flex">
        <ul
          aria-label="Quick periods"
          class="flex w-40 flex-col gap-1 border-e border-default p-2"
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
            v-model:placeholder="view"
            range
            :number-of-months="isExpanded ? 2 : 1"
            :max-value="maxValue"
            :is-date-disabled="isDateDisabled"
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
