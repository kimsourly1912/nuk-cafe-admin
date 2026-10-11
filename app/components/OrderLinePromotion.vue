<script setup lang="ts">
/**
 * An order line's promotion as it was sold (M1, D163): "20% off · Coffee week · was $7.00". The
 * customer's order, the counter and the reports show it under the line, so everyone sees why the
 * price is lower.
 *
 * @example
 * <OrderLinePromotion :line="line" />
 */
defineProps<{
  line: { quantity: number, regularUnitPriceMinor: number | null, promotion: { name: string, label: string } | null }
}>()
</script>

<template>
  <p
    v-if="line.promotion"
    class="flex flex-wrap items-center gap-x-1.5 text-sm text-error"
  >
    <UIcon
      name="i-lucide-badge-percent"
      class="size-3.5 shrink-0"
    />
    <span>{{ line.promotion.label }} · {{ line.promotion.name }}</span>
    <span
      v-if="line.regularUnitPriceMinor !== null"
      class="text-muted"
    >· was {{ formatMinor(line.regularUnitPriceMinor * line.quantity) }}</span>
  </p>
</template>
