<script setup lang="ts">
/**
 * PUBLIC. Category picker, e.g. for the product form or a parent-category field.
 * Contract: docs/feature-standard.md → "Resource picker conventions".
 *
 * - The current value always stays visible, even when it isn't among the options (inactive,
 *   deleted, another type): its label comes from the options if known, else from `currentLabel`.
 * - New selections: inactive categories are **not offered** while their eligibility is an open
 *   question (progress.md Q9). This is a temporary deferral, not a rule that they're forbidden.
 * - A failed options load shows the error with Retry instead of an empty list.
 *
 * @example
 * <CategorySelect v-model="state.categoryId" type="SUB" />
 * <CategorySelect v-model="state.mainCategoryId" type="MAIN" none-label="None (main category)"
 *                 :current-label="category?.mainCategory?.categoryName" />
 */
import type { SelectItem } from '@nuxt/ui'
import { useCategoryOptions } from '../composables/useCategoryOptions'

const props = defineProps<{
  type?: 'MAIN' | 'SUB'
  /** Hide this category (e.g. the one being edited can't be its own parent). */
  excludeId?: number
  /** Adds an option that clears the value. */
  noneLabel?: string
  placeholder?: string
  /** Name of the current value from the edited record, shown if it isn't among the options. */
  currentLabel?: string
}>()

const model = defineModel<number | undefined>()

// USelect can't hold `undefined`, so "none" is represented internally by 0.
const NONE = 0

const { data: categories, status, error, refresh } = useCategoryOptions(() => ({ type: props.type }))

/** Offered as new selections: not excluded, and not inactive while Q9 is open. */
const selectable = computed(() => categories.value.filter(c =>
  c.id !== undefined && c.id !== props.excludeId && c.status !== 'INACTIVE'))

/** The current value when it isn't selectable: kept visible (and kept) with the best label known. */
const currentItem = computed<SelectItem | undefined>(() => {
  const id = model.value
  if (id === undefined || selectable.value.some(c => c.id === id)) return undefined
  const known = categories.value.find(c => c.id === id)
  const name = known?.categoryName ?? props.currentLabel ?? `#${id}`
  const note = known?.status === 'INACTIVE' ? ' (inactive)' : !known && status.value === 'success' ? ' (unavailable)' : ''
  return { label: `${name}${note}`, value: id }
})

const items = computed<SelectItem[]>(() => [
  ...(props.noneLabel ? [{ label: props.noneLabel, value: NONE }] : []),
  ...(currentItem.value ? [currentItem.value] : []),
  ...selectable.value.map(c => ({ label: c.categoryName, value: c.id })),
])

const value = computed({
  get: () => model.value ?? (props.noneLabel ? NONE : undefined),
  set: (v: number | undefined) => {
    model.value = v === NONE ? undefined : v
  },
})
</script>

<template>
  <div class="w-full space-y-1">
    <USelect
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
