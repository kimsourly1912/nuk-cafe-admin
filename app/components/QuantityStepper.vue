<script setup lang="ts">
/**
 * A quantity: − the number + in a pill (owner, 2026-10-02, D128), Nuxt UI buttons and input. The
 * number never leaves `min`–`max`; − is disabled at `min`, + at `max`.
 *
 * Touch screens get no keyboard: the field has `inputmode="none"`, so tapping it on a phone or tablet
 * doesn't pop one up (− and + are the way there); with a keyboard (a computer) a number can still
 * be typed, applied on Enter or on leaving the field, and ↑ / ↓ step it. The attribute is the same
 * for every visitor, so the server-rendered menu needs no width check.
 *
 * @example
 * <QuantityStepper v-model="quantity" :max="LINE_MAX_QUANTITY" label="Iced Latte" />
 */
const props = withDefaults(defineProps<{
  /** What is being counted, for the buttons' and the field's names: "Iced Latte". */
  label: string
  min?: number
  max?: number
  disabled?: boolean
  size?: 'sm' | 'md'
}>(), { min: 1, max: 99, size: 'md' })

const quantity = defineModel<number>({ required: true })

/** What the field shows while typing; the model changes on Enter or blur. */
const draft = ref(String(quantity.value))
watch(quantity, (value) => {
  draft.value = String(value)
})

function set(value: number) {
  const next = Math.min(Math.max(Math.round(value), props.min), props.max)
  draft.value = String(next)
  if (next !== quantity.value) quantity.value = next
}

/** A typed number, kept within the limits; anything else goes back to the current quantity. */
function commit() {
  const typed = Number.parseInt(draft.value, 10)
  if (Number.isNaN(typed)) draft.value = String(quantity.value)
  else set(typed)
}
</script>

<template>
  <div
    class="inline-flex items-center gap-0.5 rounded-full border border-default bg-default p-0.5"
    :class="{ 'opacity-75': disabled }"
  >
    <UButton
      icon="i-lucide-minus"
      color="neutral"
      variant="ghost"
      :size="size"
      square
      class="rounded-full"
      :disabled="disabled || quantity <= min"
      :aria-label="`Decrease quantity of ${label}`"
      @click="set(quantity - 1)"
    />
    <UInput
      v-model="draft"
      type="text"
      inputmode="none"
      enterkeyhint="done"
      autocomplete="off"
      variant="none"
      :size="size"
      :disabled="disabled"
      :aria-label="`Quantity of ${label}`"
      class="w-9"
      :ui="{ base: 'px-0 text-center tabular-nums font-medium' }"
      @keydown.enter.prevent="commit"
      @keydown.up.prevent="set(quantity + 1)"
      @keydown.down.prevent="set(quantity - 1)"
      @blur="commit"
    />
    <UButton
      icon="i-lucide-plus"
      color="neutral"
      variant="ghost"
      :size="size"
      square
      class="rounded-full"
      :disabled="disabled || quantity >= max"
      :aria-label="`Increase quantity of ${label}`"
      @click="set(quantity + 1)"
    />
  </div>
</template>
