<script setup lang="ts">
/**
 * Items of one section (or one search group): rows on phones, cards from `sm` in a grid laid out by
 * the column's own width (one, two or three per row; D93). CSS only, so the server's page and the
 * browser's agree (D95).
 */
import type { PublicMenuItem } from '#shared/contracts/public-menu'
import MenuItemCard from './MenuItemCard.vue'

defineProps<{
  items: PublicMenuItem[]
  closed: boolean
  quantityOf: (item: PublicMenuItem) => number
  highlight?: string
}>()
const emit = defineEmits<{
  'open': [item: PublicMenuItem]
  'add': [item: PublicMenuItem]
  'set-quantity': [item: PublicMenuItem, quantity: number]
}>()
</script>

<template>
  <div class="@container">
    <div class="grid grid-cols-1 max-sm:divide-y max-sm:divide-default sm:gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
      <MenuItemCard
        v-for="item in items"
        :key="item.id"
        :item="item"
        :quantity="quantityOf(item)"
        :closed="closed"
        :highlight="highlight"
        @open="emit('open', item)"
        @add="emit('add', item)"
        @set-quantity="value => emit('set-quantity', item, value)"
      />
    </div>
  </div>
</template>
