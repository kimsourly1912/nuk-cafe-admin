<script setup lang="ts">
/** The order's subtotal and "Review order" (`/checkout`, D100; not while closed or empty). */
const tenantPath = useTenantPath()

defineProps<{
  subtotalMinor: number
  count: number
  closed: boolean
  closedNote?: string
}>()
</script>

<template>
  <div class="w-full space-y-3">
    <div class="flex items-baseline justify-between">
      <span class="font-semibold text-highlighted">Subtotal</span>
      <span class="text-lg font-semibold text-highlighted">{{ formatMinor(subtotalMinor) }}</span>
    </div>
    <UButton
      label="Review order"
      :to="tenantPath('/checkout')"
      size="lg"
      block
      :disabled="closed || !count"
    />
    <p
      v-if="closed"
      class="text-center text-sm text-muted"
    >
      {{ closedNote ?? 'Closed now.' }}
    </p>
  </div>
</template>
