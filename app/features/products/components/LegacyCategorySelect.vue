<script setup lang="ts">
/**
 * TEMPORARY (step 3.8b part 3, removed in 3b): the legacy `/api/v1` category picker, kept for the
 * old Menu items screen until it moves to the new API. Categories themselves moved to the new API.
 *
 * Category picker, e.g. for the product form or a parent-category field.
 * Contract: docs/feature-standard.md → "Resource picker conventions".
 *
 * - The current value always stays visible, even when it isn't among the options (inactive,
 *   deleted, another type): its label comes from the options if known, else from `currentLabel`.
 * - New selections: inactive categories are **not offered** while their eligibility is an open
 *   question (progress.md Q9). This is a temporary deferral, not a rule that they're forbidden.
 * - A failed options load shows the error with Retry instead of an empty list.
 *
 * @example
 * <CategorySelect v-model="state.categoryId" :current-label="product?.category.name" />
 * <CategorySelect v-model="state.parentId" level="main" none-label="None (main category)" />
 */
import type { SelectItem } from '@nuxt/ui'
import { useLegacyCategoryOptions as useCategoryOptions } from '../composables/useLegacyCategoryOptions'

// Attributes such as `aria-label` and `id` belong on the select itself (its accessible name);
// only `class` sizes the wrapper (full width unless a class is given).
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const selectAttrs = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})

const props = defineProps<{
  level?: 'main' | 'sub'
  /** Hide this category (e.g. the one being edited can't be its own parent). */
  excludeId?: string
  /** Adds an option that clears the value. */
  noneLabel?: string
  placeholder?: string
  /** Name of the current value from the edited record, shown if it isn't among the options. */
  currentLabel?: string
  /** Also offer inactive categories: for filters, where no new relationship is made (Q9 doesn't apply). */
  includeInactive?: boolean
}>()

const model = defineModel<string | undefined>()

// USelect can't hold `undefined` or '', so "none" is represented internally by this value.
const NONE = '__none__'

const { data: categories, status, error, refresh } = useCategoryOptions(() => ({ level: props.level }))

/** Offered as new selections: not excluded, and not inactive while Q9 is open. */
const selectable = computed(() => categories.value.filter(c =>
  c.id !== props.excludeId && (props.includeInactive || c.status !== 'INACTIVE')))

/** The current value when it isn't selectable: kept visible (and kept) with the best label known. */
const currentItem = computed<SelectItem | undefined>(() => {
  const id = model.value
  if (id === undefined || selectable.value.some(c => c.id === id)) return undefined
  const known = categories.value.find(c => c.id === id)
  const name = known?.name ?? props.currentLabel ?? 'Unknown category'
  const note = known?.status === 'INACTIVE' ? ' (inactive)' : !known && status.value === 'success' ? ' (unavailable)' : ''
  return { label: `${name}${note}`, value: id }
})

const items = computed<SelectItem[]>(() => [
  ...(props.noneLabel ? [{ label: props.noneLabel, value: NONE }] : []),
  ...(currentItem.value ? [currentItem.value] : []),
  ...selectable.value.map(c => ({ label: c.name, value: c.id })),
])

const value = computed({
  get: () => model.value ?? (props.noneLabel ? NONE : undefined),
  set: (v: string | undefined) => {
    model.value = v === NONE ? undefined : v
  },
})
</script>

<template>
  <div
    class="space-y-1"
    :class="attrs.class ?? 'w-full'"
  >
    <USelect
      v-bind="selectAttrs"
      v-model="value"
      :items="items"
      :loading="status === 'pending'"
      :placeholder="placeholder ?? 'Select a category'"
      class="w-full"
    />
    <p
      v-if="error"
      class="flex items-center gap-1 text-sm text-error"
    >
      Could not load categories: {{ error.message }}
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
