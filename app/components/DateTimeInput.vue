<script setup lang="ts">
/**
 * A day and a time of day in one field, replacing the browser's `datetime-local` (its picker
 * looks different in every browser and can't be themed). A button shows it ("Mon, 19 Oct 2026,
 * 12:00 PM") and opens a calendar with a `<TimeInput>` under it. What's picked there previews on
 * the button, but only Done sets the value; closing otherwise keeps the previous one. The value is the same
 * `YYYY-MM-DDTHH:mm` string in the device's time that `datetime-local` used, or `''` while empty.
 *
 * `min` and `max` (the same format) grey out days outside them; the time isn't limited, so check
 * the whole value in the form's own rules.
 *
 * From `sm` it's a popover; on phones a bottom sheet (like the report period picker) with the
 * calendar full width and Cancel / Done in its footer.
 */
import type { DateValue } from '@internationalized/date'
import { Time, getLocalTimeZone, parseDate, today } from '@internationalized/date'

const props = defineProps<{
  /** The field's name for assistive tech: "Date and time". */
  label: string
  min?: string
  max?: string
  disabled?: boolean
}>()
const model = defineModel<string>({ required: true })

const { isCompact } = useLayoutContext()
const DEFAULT_TIME = new Time(12, 0)
const open = ref(false)
// What's picked while the popover is open. The button previews it, but only Done makes it the
// value: closing any other way (outside click, Escape) drops it, and the button shows the value again.
const draft = ref(model.value)
watch(open, (isOpen) => {
  if (isOpen) draft.value = model.value
})
const shown = computed(() => (open.value ? draft.value : model.value))

const parts = computed(() => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(shown.value)
  return match ? { day: match[1]!, time: new Time(Number(match[2]), Number(match[3])) } : undefined
})
const day = computed(() => (parts.value ? parseDate(parts.value.day) : undefined))
const time = computed(() => parts.value?.time)
const minDay = computed(() => (props.min ? parseDate(props.min.slice(0, 10)) : undefined))
const maxDay = computed(() => (props.max ? parseDate(props.max.slice(0, 10)) : undefined))

const text = computed(() => {
  if (!parts.value) return 'Choose a date and time'
  const date = new Date(`${parts.value.day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return `${date}, ${formatClock(parts.value.time.hour * 60 + parts.value.time.minute)}`
})

const pad = (n: number) => String(n).padStart(2, '0')
const join = (d: string, t: Time) => `${d}T${pad(t.hour)}:${pad(t.minute)}`

function chooseDay(value: DateValue | DateValue[] | null | undefined | { start?: DateValue, end?: DateValue }) {
  if (!value || Array.isArray(value) || !('toString' in value) || 'start' in value) return
  draft.value = join(value.toString(), time.value ?? DEFAULT_TIME)
}

function chooseTime(value: Time | undefined) {
  if (!value) return
  // Without a day yet, a time starts from today so the field never holds half a value.
  const d = parts.value?.day ?? today(getLocalTimeZone()).toString()
  draft.value = join(d, new Time(value.hour, value.minute))
}

function done() {
  model.value = draft.value
  open.value = false
}
</script>

<template>
  <AppDrawer
    v-if="isCompact"
    v-model:open="open"
    :title="label"
    description="Choose the day and the time."
    :ui="{ footer: 'flex-row gap-2' }"
  >
    <UButton
      :label="text"
      icon="i-lucide-calendar-clock"
      color="neutral"
      variant="outline"
      class="w-full justify-start"
      :disabled="disabled"
      :aria-label="`${label}: ${text}`"
    />
    <template #body>
      <div class="space-y-3">
        <UCalendar
          :model-value="day"
          :min-value="minDay"
          :max-value="maxDay"
          :aria-label="label"
          size="lg"
          class="w-full"
          prevent-deselect
          @update:model-value="chooseDay"
        />
        <div class="flex items-center gap-2 border-t border-default pt-3">
          <UIcon
            name="i-lucide-clock"
            class="size-4 shrink-0 text-muted"
          />
          <TimeInput
            :model-value="time"
            :hour-cycle="12"
            size="lg"
            :aria-label="`${label}: time`"
            class="flex-1"
            @update:model-value="chooseTime"
          />
        </div>
      </div>
    </template>
    <template #footer>
      <UButton
        label="Cancel"
        color="neutral"
        variant="outline"
        @click="open = false"
      />
      <UButton
        label="Done"
        class="flex-1 justify-center"
        @click="done()"
      />
    </template>
  </AppDrawer>

  <UPopover
    v-else
    v-model:open="open"
    :content="{ align: 'start' }"
  >
    <UButton
      :label="text"
      icon="i-lucide-calendar-clock"
      color="neutral"
      variant="outline"
      class="w-full justify-start"
      :disabled="disabled"
      :aria-label="`${label}: ${text}`"
    />
    <template #content>
      <div class="space-y-2 p-2">
        <UCalendar
          :model-value="day"
          :min-value="minDay"
          :max-value="maxDay"
          :aria-label="label"
          prevent-deselect
          @update:model-value="chooseDay"
        />
        <div class="flex items-center gap-2 border-t border-default pt-3">
          <UIcon
            name="i-lucide-clock"
            class="size-4 shrink-0 text-muted"
          />
          <TimeInput
            :model-value="time"
            :hour-cycle="12"
            :aria-label="`${label}: time`"
            class="flex-1"
            @update:model-value="chooseTime"
          />
          <UButton
            label="Done"
            size="sm"
            @click="done()"
          />
        </div>
      </div>
    </template>
  </UPopover>
</template>
