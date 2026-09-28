<script setup lang="ts">
/**
 * PUBLIC. Category picker: a parent (`level="main"`), a menu item's category (`level="leaf"`), or
 * any category (a list filter). Contract: docs/feature-standard.md → "Resource picker conventions".
 *
 * - `main`: active top-level categories. `leaf`: active categories without sub-categories (items
 *   go only in leaves, D44; one with archived sub-categories isn't a leaf either).
 * - The current value always stays visible, even when it isn't selectable (archived, no longer a
 *   leaf, gone): its label comes from the options if known, else from `currentLabel`.
 * - Archived categories are never offered for new selections (D45), except with `includeArchived`
 *   (filters, where no relationship is made).
 * - A failed options load shows the error with Retry instead of an empty list.
 *
 * @example
 * <CategorySelect v-model="state.categoryId" level="leaf" :current-label="item?.categoryName" />
 * <CategorySelect v-model="state.parentId" level="main" none-label="None (main category)" />
 */
import type { SelectItem } from '@nuxt/ui'
import type { MenuCategory } from '#shared/contracts/menu-categories'
import { useCategoryOptions } from '../composables/useCategoryOptions'

// Attributes such as `aria-label` and `id` belong on the select itself (its accessible name);
// only `class` sizes the wrapper (full width unless a class is given).
defineOptions({ inheritAttrs: false })
const attrs = useAttrs()
const selectAttrs = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})

const props = defineProps<{
  level?: 'main' | 'leaf'
  /** Hide this category (e.g. the one being edited can't be its own parent). */
  excludeId?: string
  /** Adds an option that clears the value. */
  noneLabel?: string
  placeholder?: string
  /** Name of the current value from the edited record, shown if it isn't among the options. */
  currentLabel?: string
  /** Also offer archived categories: for filters, where no new relationship is made. */
  includeArchived?: boolean
}>()

const model = defineModel<string | undefined>()

// USelect can't hold `undefined` or '', so "none" is represented internally by this value.
const NONE = '__none__'

const { data: categories, status, error, refresh } = useCategoryOptions()

const byId = computed(() => new Map(categories.value.map(c => [c.id, c])))
/** Categories that have a sub-category, archived or not: never a leaf. */
const parents = computed(() => new Set(categories.value.flatMap(c => (c.parentId ? [c.parentId] : []))))

const fitsLevel = (c: MenuCategory) => props.level === 'main' ? c.parentId === null : props.level === 'leaf' ? !parents.value.has(c.id) : true

/** "Coffee › Espresso" for a sub-category, so equal names under different mains stay apart. */
const labelOf = (c: MenuCategory) => {
  const parent = c.parentId ? byId.value.get(c.parentId) : undefined
  return parent ? `${parent.name} › ${c.name}` : c.name
}

/** Offered as new selections, in tree order (each main followed by its subs). */
const selectable = computed(() => {
  const ok = (c: MenuCategory) => c.id !== props.excludeId && (props.includeArchived || c.status === 'active') && fitsLevel(c)
  const bySort = (a: MenuCategory, b: MenuCategory) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
  const mains = categories.value.filter(c => c.parentId === null).sort(bySort)
  return mains.flatMap(main => [main, ...categories.value.filter(c => c.parentId === main.id).sort(bySort)]).filter(ok)
})

/** The current value when it isn't selectable: kept visible (and kept) with the best label known. */
const currentItem = computed<SelectItem | undefined>(() => {
  const id = model.value
  if (id === undefined || selectable.value.some(c => c.id === id)) return undefined
  const known = byId.value.get(id)
  const name = known ? labelOf(known) : props.currentLabel ?? 'Unknown category'
  const note = known?.status === 'archived'
    ? ' (archived)'
    : known && props.level === 'leaf' && parents.value.has(id)
      ? ' (has sub-categories)'
      : !known && status.value === 'success' ? ' (unavailable)' : ''
  return { label: `${name}${note}`, value: id }
})

const items = computed<SelectItem[]>(() => [
  ...(props.noneLabel ? [{ label: props.noneLabel, value: NONE }] : []),
  ...(currentItem.value ? [currentItem.value] : []),
  ...selectable.value.map(c => ({ label: labelOf(c), value: c.id })),
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
