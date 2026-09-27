<script setup lang="ts">
/**
 * Status filter as tabs with counts: "All 24 · Active 20 · Inactive 4" (Shopify-style views).
 * Replaces the status `USelect` in list toolbars; binds to the same filter value (`ANY` = all).
 *
 * `tabs` replaces the ACTIVE/INACTIVE pair for resources with other statuses (the menu API's
 * `active` / `archived`); `counts` is keyed by the same values, plus `all`.
 *
 * @example
 * <StatusTabs v-model="filters.status" :counts="counts" />
 * <StatusTabs v-model="status" :tabs="[{ label: 'Active', value: 'active' }, { label: 'Archived', value: 'archived' }]" :counts="{ all: 3, active: 2, archived: 1 }" />
 */
import type { TabsItem } from '@nuxt/ui'

const props = defineProps<{
  /** Counts per status value, plus `all`; badges are left out until they're known. */
  counts?: Partial<Record<string, number>> | null
  /** The statuses after "All"; default: Active and Inactive. */
  tabs?: { label: string, value: string }[]
  disabled?: boolean
}>()

const status = defineModel<string>({ required: true })

const DEFAULT_TABS = [
  { label: STATUS_LABELS.ACTIVE, value: 'ACTIVE' },
  { label: STATUS_LABELS.INACTIVE, value: 'INACTIVE' },
]

const items = computed<TabsItem[]>(() => [
  { label: 'All', value: ANY as string, badge: props.counts?.all },
  ...(props.tabs ?? DEFAULT_TABS).map(tab => ({ ...tab, badge: props.counts?.[tab.value] })),
].map(item => ({ ...item, disabled: props.disabled, badge: item.badge === undefined ? undefined : { label: String(item.badge), color: 'neutral', variant: 'subtle', size: 'sm' } })))
</script>

<template>
  <!-- UTabs puts attributes on its wrapper, not the tablist: the group carries the name. -->
  <div
    role="group"
    aria-label="Status"
  >
    <UTabs
      v-model="status"
      :items="items"
      :content="false"
      variant="link"
      size="sm"
      :ui="{ root: 'w-auto', list: 'border-b-0' }"
    />
  </div>
</template>
