<script setup lang="ts">
/**
 * One day for a promotion (M1, D163): a button showing it ("Thu, 15 Oct 2026") that opens a
 * calendar. `YYYY-MM-DD` in and out; `min` greys out earlier days.
 */
import type { DateValue } from '@internationalized/date'
import { parseDate } from '@internationalized/date'

const props = defineProps<{
  /** The field's name for assistive tech: "First day". */
  label: string
  min?: string
  disabled?: boolean
}>()
const model = defineModel<string>({ required: true })

const open = ref(false)
const value = computed(() => (/^\d{4}-\d{2}-\d{2}$/.test(model.value) ? parseDate(model.value) : undefined))
const minValue = computed(() => (props.min ? parseDate(props.min) : undefined))

const text = computed(() => (value.value
  ? formatDay(model.value)
  : 'Choose a day'))

function choose(day: DateValue | DateValue[] | null | undefined | { start?: DateValue, end?: DateValue }) {
  if (!day || Array.isArray(day) || !('toString' in day) || 'start' in day) return
  model.value = day.toString()
  open.value = false
}
</script>

<template>
  <UPopover v-model:open="open">
    <UButton
      :label="text"
      icon="i-lucide-calendar"
      color="neutral"
      variant="outline"
      class="w-full justify-start"
      :disabled="disabled"
      :aria-label="`${label}: ${text}`"
    />
    <template #content>
      <UCalendar
        :model-value="value"
        :min-value="minValue"
        :aria-label="label"
        class="p-2"
        @update:model-value="choose"
      />
    </template>
  </UPopover>
</template>
