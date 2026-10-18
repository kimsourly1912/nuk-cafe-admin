<script setup lang="ts">
/**
 * A dropdown of the cafe's records (ui.md → Dropdowns): categories, branches, rules… lists that
 * grow with use. Nuxt UI's `USelectMenu` with a search box and virtual scroll (only the visible rows
 * are in the page), so it stays fast however long the list gets. Search matches anywhere in the
 * label ("milk" finds "Tea › Milk Tea"); `pinned` values ("All categories", "None") stay first and
 * are never filtered out. A fixed set the code defines (status, role, sort) stays a `USelect`.
 *
 * Attributes (`aria-label`, `placeholder`, `loading`, `disabled`, `multiple`, `size`, …) go to the select.
 * Its trigger is a combobox, like `USelect`'s (D152): `aria-label` names it and the text on it is its
 * value. As a plain button, the shown value had to be part of its name (axe: label-content-name-mismatch).
 *
 * @example
 * <RecordSelect v-model="filters.branchId" :items="branchItems" noun="branches" :pinned="[ANY]" aria-label="Branch" />
 */
import type { SelectMenuItem, SelectMenuProps } from '@nuxt/ui'

export interface RecordSelectItem {
  label: string
  value: string
  disabled?: boolean
}

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  items: RecordSelectItem[]
  /** Plural, for the search box and the empty state: "Search branches…", "No branches match". */
  noun: string
  /** Values always shown, above the matches. */
  pinned?: string[]
}>()
/** One value, or several with the `multiple` attribute. */
const model = defineModel<string | string[] | undefined>()

/**
 * The menu is at least as wide as its longest label, not just its button. Virtual rows are
 * positioned absolutely, so the browser can't size the menu to them (`min-w-fit` measures nothing):
 * the width is estimated from the label length (`ch`) plus room for the padding and check mark.
 */
const contentProps = computed<SelectMenuProps['content']>(() => ({
  // `style` isn't in the content prop's type, but falls through to the menu's element.
  style: { minWidth: `calc(${Math.max(0, ...props.items.map(item => item.label.length))}ch + 3.5rem)`, maxWidth: '90vw' },
} as object))

/** The empty trigger keeps its line height. */
const placeholder = computed(() => (useAttrs().placeholder as string | undefined) || String.fromCharCode(160))

function selectedLabel(value: unknown): string {
  const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
  return values.map(one => props.items.find(item => item.value === one)?.label ?? '').filter(Boolean).join(', ')
}

const searchTerm = ref('')
const shown = computed<SelectMenuItem[]>(() => {
  const term = searchTerm.value.trim().toLocaleLowerCase()
  if (!term) return props.items
  const pinned = props.items.filter(item => props.pinned?.includes(item.value))
  const matches = props.items.filter(item => !props.pinned?.includes(item.value) && item.label.toLocaleLowerCase().includes(term))
  // With pinned rows the menu is never empty, so say there are no matches in a row of its own.
  if (!matches.length && pinned.length) return [...pinned, { type: 'label' as const, label: `No ${props.noun} match “${searchTerm.value.trim()}”` }]
  return [...pinned, ...matches]
})
</script>

<template>
  <USelectMenu
    v-bind="$attrs"
    v-model="model"
    v-model:search-term="searchTerm"
    role="combobox"
    :items="shown"
    value-key="value"
    ignore-filter
    :content="contentProps"
    virtualize
    :search-input="{ placeholder: `Search ${noun}…` }"
  >
    <!-- The trigger's text comes from every item: a search that filters the chosen one out of the
         menu must not turn it into its raw value (an id). -->
    <template #default="{ modelValue }">
      <span
        v-if="selectedLabel(modelValue)"
        class="truncate"
      >{{ selectedLabel(modelValue) }}</span>
      <span
        v-else
        class="truncate text-dimmed"
      >{{ placeholder }}</span>
    </template>
    <template #empty>
      No {{ noun }} match “{{ searchTerm }}”
    </template>
  </USelectMenu>
</template>
