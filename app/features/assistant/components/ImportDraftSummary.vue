<script setup lang="ts">
import type { AssistantImportDraft } from '#shared/contracts/assistant-import'
import { useCategoryOptions } from '~/features/categories'

const props = defineProps<{ draft: AssistantImportDraft }>()
const categories = useCategoryOptions()
const category = computed(() => {
  if (!props.draft.categoryId) return 'Choose a category'
  if (categories.loading.value) return 'Loading category…'
  const record = categories.data.value.find(c => c.id === props.draft.categoryId)
  return record ? `${record.name}${record.status === 'archived' ? ' (archived)' : ''}` : 'Category unavailable'
})
const offered = computed(() => props.draft.variations.filter(c => c.status === 'active'))
const price = computed(() => {
  const prices = offered.value.flatMap(c => c.priceMinor === null ? [] : [c.priceMinor])
  if (!prices.length) return 'No offered price'
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return min === max ? formatMinor(min) : `${formatMinor(min)}–${formatMinor(max)}`
})
</script>

<template>
  <div class="space-y-1 break-words text-sm">
    <p>Saved category: {{ category }}</p>
    <p>Saved prices (USD): {{ price }} · {{ offered.length }} offered {{ offered.length === 1 ? 'version' : 'versions' }}</p>
  </div>
</template>
