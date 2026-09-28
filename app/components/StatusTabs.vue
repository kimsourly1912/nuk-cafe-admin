<script setup lang="ts">
/**
 * Status filter as tabs with counts: "All 3 · Active 2 · Archived 1" (Shopify-style views). Binds to
 * the list's status filter (`ANY` = "All"). Each resource names its statuses (`tabs`); `counts` is
 * keyed by the same values, plus `all`.
 *
 * @example
 * <StatusTabs v-model="status" :tabs="[{ label: 'Active', value: 'active' }, { label: 'Archived', value: 'archived' }]" :counts="{ all: 3, active: 2, archived: 1 }" />
 */
import type { TabsItem } from '@nuxt/ui'

const props = defineProps<{
  /** Counts per status value, plus `all`; badges are left out until they're known. */
  counts?: Partial<Record<string, number>> | null
  /** The statuses after "All". */
  tabs: { label: string, value: string }[]
  disabled?: boolean
  /** `md` for a page where the tabs are the main filter (Categories). */
  size?: 'sm' | 'md'
}>()

const status = defineModel<string>({ required: true })

const items = computed<TabsItem[]>(() => [
  { label: 'All', value: ANY as string, badge: props.counts?.all },
  ...props.tabs.map(tab => ({ ...tab, badge: props.counts?.[tab.value] })),
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
      :size="size ?? 'sm'"
      :ui="{ root: 'w-auto', list: 'border-b-0' }"
    />
  </div>
</template>
