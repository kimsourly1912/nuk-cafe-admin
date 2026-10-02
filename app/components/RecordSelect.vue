<script setup lang="ts">
/**
 * A dropdown of the cafe's records (ui.md → Dropdowns): categories, branches, rules… lists that
 * grow with use. Nuxt UI's `USelectMenu` with a search box and virtual scroll (only the visible rows
 * are in the page), so it stays fast however long the list gets. Search matches anywhere in the
 * label ("milk" finds "Tea › Milk Tea"); `pinned` values ("All categories", "None") stay first and
 * are never filtered out. A fixed set the code defines (status, role, sort) stays a `USelect`.
 *
 * Attributes (`aria-label`, `placeholder`, `loading`, `disabled`, `multiple`, `size`, …) go to the select.
 *
 * @example
 * <RecordSelect v-model="filters.branchId" :items="branchItems" noun="branches" :pinned="[ANY]" aria-label="Branch" />
 */
import type { SelectMenuItem } from '@nuxt/ui'

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
    :items="shown"
    value-key="value"
    ignore-filter
    virtualize
    :search-input="{ placeholder: `Search ${noun}…` }"
  >
    <template #empty>
      No {{ noun }} match “{{ searchTerm }}”
    </template>
  </USelectMenu>
</template>
