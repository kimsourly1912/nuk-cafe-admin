<script setup lang="ts">
/** The order's subtotal and "Review order" (`/checkout`, D100; not while closed or empty). */
const tenantPath = useTenantPath()

defineProps<{
  subtotalMinor: number
  /** What promotions take off (M1, D163): "You save $1.40". */
  savingsMinor?: number
  count: number
  closed: boolean
  closedNote?: string
}>()
</script>

<template>
  <div class="w-full space-y-3">
    <p
      v-if="savingsMinor"
      class="flex items-center justify-between text-sm text-error"
    >
      <span class="flex items-center gap-1.5"><UIcon
        name="i-lucide-badge-percent"
        class="size-4"
      />You save</span>
      <span class="font-medium tabular-nums">{{ formatMinor(savingsMinor) }}</span>
    </p>
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
