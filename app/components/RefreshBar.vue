<script setup lang="ts">
/**
 * A refetch running behind the content (`useApiQuery().refreshing`): a thin moving bar on the
 * header's bottom edge, and the panel's body dimmed until the new data arrives (the CSS in
 * `tailwind.css`). It overlays the edge, so nothing moves; a refresh under 150ms shows nothing, and
 * once shown it stays 300ms (`useRefreshIndicator`). Screen readers hear "Updating…".
 *
 * Put it as the last element of `UDashboardPanel`'s `#header` slot (a direct child of the panel,
 * which is what the dimming looks for), never inside a toolbar.
 *
 * @example
 * <template #header>
 *   <UDashboardNavbar title="Staff" />
 *   <UDashboardToolbar>…</UDashboardToolbar>
 *   <RefreshBar :active="refreshing" />
 * </template>
 */
const props = defineProps<{ active: boolean }>()
const shown = useRefreshIndicator(() => props.active)
</script>

<template>
  <div
    data-slot="refresh-bar"
    :data-active="shown || undefined"
    class="relative z-10 h-0 print:hidden"
  >
    <UProgress
      v-if="shown"
      :model-value="null"
      size="2xs"
      :ui="{ root: 'absolute inset-x-0 -top-0.5', base: 'rounded-none bg-transparent', indicator: 'rounded-none' }"
      aria-hidden="true"
    />
    <span
      role="status"
      class="sr-only"
    >{{ shown ? 'Updating…' : '' }}</span>
  </div>
</template>
