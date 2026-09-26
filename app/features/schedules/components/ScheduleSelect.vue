<script setup lang="ts">
/**
 * PUBLIC. Multiple-schedule picker, e.g. for a menu item's `scheduleIds`.
 * Contract: docs/feature-standard.md → "Resource picker conventions".
 *
 * - Selected schedules always stay visible, even when they aren't selectable (inactive) or no
 *   longer exist ("#12 (unavailable)"). Nothing is cleared silently.
 * - New selections: inactive schedules are **not offered** while their eligibility is an open
 *   question (progress.md Q9), as in `CategorySelect`.
 * - A failed load shows the error with Retry instead of an empty list.
 *
 * @example
 * <ScheduleSelect v-model="state.scheduleIds" />
 */
import type { SelectItem } from '@nuxt/ui'
import { useScheduleOptions } from '../composables/useScheduleOptions'

// Attributes such as `aria-label` and `id` belong on the select itself (its accessible name);
// only `class` sizes the wrapper (full width unless a class is given).
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const selectAttrs = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})

defineProps<{ placeholder?: string }>()

const model = defineModel<number[]>({ default: () => [] })

const { data: schedules, status, error, refresh } = useScheduleOptions()

const selectable = computed(() => schedules.value.filter(s => s.id !== undefined && s.status !== 'INACTIVE'))

/** Selected ids that aren't selectable: kept visible with the best label known. */
const currentItems = computed<SelectItem[]>(() => model.value
  .filter(id => !selectable.value.some(s => s.id === id))
  .map((id) => {
    const known = schedules.value.find(s => s.id === id)
    const note = known ? ' (inactive)' : status.value === 'success' ? ' (unavailable)' : ''
    return { label: `${known?.name ?? `#${id}`}${note}`, value: id }
  }))

const items = computed<SelectItem[]>(() => [
  ...currentItems.value,
  ...selectable.value.map(s => ({ label: s.name, value: s.id })),
])
</script>

<template>
  <div
    class="space-y-1"
    :class="attrs.class ?? 'w-full'"
  >
    <USelect
      v-bind="selectAttrs"
      v-model="model"
      :items="items"
      multiple
      :loading="status === 'pending'"
      :placeholder="placeholder ?? 'No schedule'"
      class="w-full"
    />
    <p
      v-if="error"
      class="flex items-center gap-1 text-sm text-error"
    >
      Could not load schedules: {{ error.message }}
      <UButton
        label="Retry"
        size="xs"
        variant="link"
        color="error"
        :loading="status === 'pending'"
        @click="refresh()"
      />
    </p>
  </div>
</template>
