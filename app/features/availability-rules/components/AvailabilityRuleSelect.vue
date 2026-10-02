<script setup lang="ts">
/**
 * PUBLIC. Picks the availability rules of a category or menu item (`availabilityRuleIds`).
 * Contract: docs/feature-standard.md → "Resource picker conventions".
 *
 * - Chosen rules always stay visible, also archived ones ("Breakfast (archived)"): a record keeps
 *   an archived rule until it's removed (D63). Nothing is cleared silently.
 * - New selections: only active rules (the server refuses archived ones).
 * - A failed load shows the error with Retry instead of an empty list.
 * - Searchable with virtual scroll (`RecordSelect`, ui.md → Dropdowns).
 *
 * @example
 * <AvailabilityRuleSelect v-model="state.availabilityRuleIds" aria-label="Availability" />
 */
import { MAX_TARGET_RULES } from '#shared/contracts/menu-availability'
import { useAvailabilityRuleOptions } from '../composables/useAvailabilityRuleOptions'

// Attributes such as `aria-label` belong on the select itself; only `class` sizes the wrapper.
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const selectAttrs = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})

defineProps<{ placeholder?: string }>()

const model = defineModel<string[]>({ default: () => [] })

const { data: rules, status, error, refresh } = useAvailabilityRuleOptions()

const selectable = computed(() => rules.value.filter(r => r.status === 'active'))

/** Chosen ids that aren't selectable: kept visible with the best label known. */
const currentItems = computed<{ label: string, value: string }[]>(() => model.value
  .filter(id => !selectable.value.some(r => r.id === id))
  .map((id) => {
    const known = rules.value.find(r => r.id === id)
    const note = known ? ' (archived)' : status.value === 'success' ? ' (unavailable)' : ''
    return { label: `${known?.name ?? 'Unknown rule'}${note}`, value: id }
  }))

const full = computed(() => model.value.length >= MAX_TARGET_RULES)
const items = computed<{ label: string, value: string, disabled?: boolean }[]>(() => [
  ...currentItems.value,
  ...selectable.value.map(r => ({ label: r.name, value: r.id, disabled: full.value && !model.value.includes(r.id) })),
])
</script>

<template>
  <div
    class="space-y-1"
    :class="attrs.class ?? 'w-full'"
  >
    <RecordSelect
      v-bind="selectAttrs"
      :model-value="model"
      :items="items"
      noun="rules"
      multiple
      :loading="status === 'pending'"
      :placeholder="placeholder ?? 'Whenever the cafe is open'"
      class="w-full"
      @update:model-value="value => model = Array.isArray(value) ? value : []"
    />
    <p
      v-if="error"
      class="flex items-center gap-1 text-sm text-error"
    >
      Could not load availability rules: {{ error.message }}
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
