<script setup lang="ts">
/**
 * View on menu (D145): opens the customer menu in a new tab with this item's detail open
 * (`/c/<slug>?item=<id>`), to check a change as customers see it. Only a published item is on the
 * menu: for a draft or an archived one the button is disabled and says why. The menu page is cached
 * for up to a minute (D122), so a change just saved can take that long to show there.
 */
import type { ItemStatus } from '#shared/contracts/menu-items'
import { itemOnMenuPath } from '../utils/item-display'

const props = defineProps<{
  itemId: string
  status: ItemStatus
}>()

const tenantPath = useTenantPath()
const href = computed(() => itemOnMenuPath(tenantPath('/'), props.itemId))
const reason = computed(() => {
  if (props.status === 'draft') return 'Publish it to see it on the menu'
  if (props.status === 'archived') return 'Archived items aren\'t on the menu'
  return 'Opens the menu in a new tab. Changes can take a minute to show.'
})
</script>

<template>
  <UTooltip :text="reason">
    <UButton
      label="View on menu"
      trailing-icon="i-lucide-external-link"
      color="neutral"
      variant="ghost"
      :ui="{ label: 'max-sm:sr-only' }"
      :to="status === 'active' ? href : undefined"
      target="_blank"
      :disabled="status !== 'active'"
      :aria-label="status === 'active' ? 'View on menu (opens in a new tab)' : `View on menu: ${reason}`"
    />
  </UTooltip>
</template>
