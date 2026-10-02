<script setup lang="ts">
/** Beside the order's title: the order type, and "Clear order" while it holds anything (D124). */
defineProps<{
  /** "Pickup" or "Table 12". */
  orderType: string
  count: number
}>()
const emit = defineEmits<{ clear: [] }>()
</script>

<template>
  <div class="flex shrink-0 items-center gap-2">
    <UButton
      v-if="count"
      label="Clear order"
      color="neutral"
      variant="link"
      size="sm"
      class="px-0"
      @click="emit('clear')"
    />
    <UBadge
      :label="orderType"
      color="neutral"
      variant="soft"
    />
  </div>
</template>
