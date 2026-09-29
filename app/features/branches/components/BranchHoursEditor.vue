<script setup lang="ts">
/**
 * Weekly hours, a row per day (D91, the owner's mockup): an Open switch and the day's windows (up
 * to three; one ending after midnight runs into the next day), "Copy Monday to weekdays" and "Copy
 * Saturday to weekend". Edits the page's draft; its fields sit inside the page's `UForm`, so their
 * errors (and the server's overlap error, on its window) show on them. Laid out by its own width.
 */
import type { BranchForm } from '../schemas/branch-form'
import { copyDay, MAX_DAY_WINDOWS, newWindow, WEEKDAY_NAMES } from '../schemas/branch-form'

defineProps<{ disabled?: boolean }>()
const form = defineModel<BranchForm>({ required: true })

function addWindow(dayIndex: number) {
  const day = form.value.days[dayIndex]!
  day.windows.push(newWindow(day))
}
function removeWindow(dayIndex: number, windowIndex: number) {
  form.value.days[dayIndex]!.windows.splice(windowIndex, 1)
}
function setOpen(dayIndex: number, open: boolean) {
  const day = form.value.days[dayIndex]!
  day.open = open
  if (open && !day.windows.length) day.windows.push(newWindow(day))
}
const nextDay = (start?: number, end?: number) => start !== undefined && end !== undefined && isOvernight(start, end)
</script>

<template>
  <section
    aria-labelledby="weekly-hours"
    class="@container space-y-4"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3
          id="weekly-hours"
          class="font-semibold text-highlighted"
        >
          Weekly hours
        </h3>
        <p class="text-sm text-muted">
          When customers can order, in the branch's time zone.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          label="Copy Monday to weekdays"
          icon="i-lucide-copy"
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="disabled"
          @click="copyDay(form, 0, [1, 2, 3, 4])"
        />
        <UButton
          label="Copy Saturday to weekend"
          icon="i-lucide-copy"
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="disabled"
          @click="copyDay(form, 5, [6])"
        />
      </div>
    </div>

    <ul class="divide-y divide-default">
      <li
        v-for="(day, dayIndex) in form.days"
        :key="dayIndex"
        :aria-label="WEEKDAY_NAMES[dayIndex]"
        class="flex flex-col gap-2 py-3 @lg:flex-row @lg:items-start @lg:gap-4"
      >
        <div class="flex items-center justify-between gap-3 @lg:w-48 @lg:shrink-0 @lg:pt-1.5">
          <span class="font-medium text-highlighted">{{ WEEKDAY_NAMES[dayIndex] }}</span>
          <USwitch
            :model-value="day.open"
            :label="day.open ? 'Open' : 'Closed'"
            :aria-label="`Open on ${WEEKDAY_NAMES[dayIndex]}`"
            :disabled="disabled"
            @update:model-value="value => setOpen(dayIndex, !!value)"
          />
        </div>

        <div
          v-if="day.open"
          class="min-w-0 flex-1 space-y-2"
        >
          <UFormField
            v-for="(window, windowIndex) in day.windows"
            :key="windowIndex"
            :name="`days.${dayIndex}.windows.${windowIndex}.end`"
            :help="nextDay(window.start, window.end) ? 'Closes the next day' : undefined"
          >
            <div class="flex items-center gap-2">
              <UInputTime
                :model-value="minuteToTime(window.start)"
                :hour-cycle="12"
                :aria-label="`${WEEKDAY_NAMES[dayIndex]} opens, window ${windowIndex + 1}`"
                :disabled="disabled"
                class="min-w-0 flex-1"
                @update:model-value="value => window.start = timeToMinute(value)"
              />
              <span class="text-muted">–</span>
              <UInputTime
                :model-value="minuteToTime(window.end)"
                :hour-cycle="12"
                :aria-label="`${WEEKDAY_NAMES[dayIndex]} closes, window ${windowIndex + 1}`"
                :disabled="disabled"
                class="min-w-0 flex-1"
                @update:model-value="value => window.end = timeToMinute(value)"
              />
              <UButton
                v-if="day.windows.length > 1"
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                :aria-label="`Remove ${WEEKDAY_NAMES[dayIndex]} window ${windowIndex + 1}`"
                :disabled="disabled"
                @click="removeWindow(dayIndex, windowIndex)"
              />
            </div>
          </UFormField>
          <UButton
            v-if="day.windows.length < MAX_DAY_WINDOWS"
            label="Add window"
            icon="i-lucide-plus"
            color="neutral"
            variant="link"
            size="sm"
            class="px-0"
            :aria-label="`Add a window on ${WEEKDAY_NAMES[dayIndex]}`"
            :disabled="disabled"
            @click="addWindow(dayIndex)"
          />
        </div>
        <p
          v-else
          class="text-sm text-muted @lg:pt-1.5"
        >
          Closed all day
        </p>
      </li>
    </ul>
  </section>
</template>
