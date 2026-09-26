<script setup lang="ts">
/**
 * PUBLIC. Category picker, e.g. for the product form or a parent-category field.
 *
 * @example
 * <CategorySelect v-model="state.categoryId" type="SUB" />
 * <CategorySelect v-model="state.mainCategoryId" type="MAIN" none-label="None (main category)" />
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
}>()

const model = defineModel<number | undefined>()

// USelect can't hold `undefined`, so "none" is represented internally by 0.
const NONE = 0

const { data: categories, status } = useCategoryOptions(() => ({ type: props.type }))

const items = computed<SelectItem[]>(() => [
  ...(props.noneLabel ? [{ label: props.noneLabel, value: NONE }] : []),
  ...categories.value
    .filter(c => c.id !== undefined && c.id !== props.excludeId)
    .map(c => ({ label: c.categoryName, value: c.id })),
])

const value = computed({
  get: () => model.value ?? (props.noneLabel ? NONE : undefined),
  set: (v: number | undefined) => {
    model.value = v === NONE ? undefined : v
  },
})
</script>

<template>
  <USelect
    v-model="value"
    :items="items"
    :loading="status === 'pending'"
    :placeholder="placeholder ?? 'Select a category'"
    class="w-full"
  />
</template>
