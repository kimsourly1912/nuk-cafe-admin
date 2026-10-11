<script setup lang="ts">
/**
 * One number on a page (ui.md → Surfaces): a soft card (Nuxt UI's `subtle` card's look, `bg-elevated/50`
 * with a light ring, drawn as one `div` so the `dl` around it stays valid), a muted label, the value large, an optional change ("+12% vs last week") and
 * icon. Place it inside a `<dl>` (it renders `dt`/`dd`); a grid of them is the usual layout.
 * A record (with actions) is an outline card instead; a number is never styled by hand.
 *
 * @example
 * <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4">
 *   <StatCard label="Paid sales" :value="formatMinor(paid)" :change="{ text: '+12%', up: true }" change-label="vs yesterday" />
 * </dl>
 */
defineProps<{
  label: string
  /** The formatted value; the `value` slot adds to it (a count in brackets). */
  value: string
  icon?: string
  /** Up is good news (green), down is bad (red). */
  change?: { text: string, up: boolean }
  /** What the change compares with: "vs yesterday". */
  changeLabel?: string
}>()
</script>

<template>
  <!-- Nuxt UI's subtle card, drawn here: a `dl` may hold only `dt`/`dd` and one `div` around them (axe). -->
  <div
    class="relative rounded-lg bg-elevated/50 p-4 ring ring-default"
    :class="icon && 'ps-12'"
  >
    <dt class="text-sm text-muted">
      <UIcon
        v-if="icon"
        :name="icon"
        class="absolute start-4 top-4.5 size-5 text-muted"
      />
      {{ label }}
    </dt>
    <dd class="mt-1 text-2xl font-semibold text-highlighted tabular-nums">
      {{ value }}
      <slot name="value" />
    </dd>
    <dd
      v-if="change"
      class="mt-1 text-xs"
      :class="change.up ? 'text-success' : 'text-error'"
    >
      {{ change.text }} <span
        v-if="changeLabel"
        class="text-muted"
      >{{ changeLabel }}</span>
    </dd>
    <slot />
  </div>
</template>
