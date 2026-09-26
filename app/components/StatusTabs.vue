<script setup lang="ts">
/**
 * Status filter as tabs with counts: "All 24 · Active 20 · Inactive 4" (Shopify-style views).
 * Replaces the status `USelect` in list toolbars; binds to the same filter value (`ANY` = all).
 *
 * @example
 * <StatusTabs v-model="filters.status" :counts="counts" />
 */
import type { TabsItem } from '@nuxt/ui'
import type { StatusCounts } from '~/composables/useStatusCounts'

const props = defineProps<{
  /** Counts per status; badges are left out until they're known. */
  counts?: StatusCounts | null
  disabled?: boolean
}>()

const status = defineModel<Status | Any>({ required: true })

const items = computed<TabsItem[]>(() => [
  { label: 'All', value: ANY, badge: props.counts?.all },
  { label: STATUS_LABELS.ACTIVE, value: 'ACTIVE', badge: props.counts?.ACTIVE },
  { label: STATUS_LABELS.INACTIVE, value: 'INACTIVE', badge: props.counts?.INACTIVE },
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
