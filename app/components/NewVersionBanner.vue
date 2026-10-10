<script setup lang="ts">
/**
 * "A new version is ready" with Reload (D149), in the admin, the counter and the platform console,
 * whose tabs stay open all day. Later hides it for this page load; the next page change updates
 * anyway (`plugins/new-version.client.ts`). Reload with unsaved input gets the browser's own
 * "Leave site?" first (the leave guard).
 */
const available = useNewVersion()
const later = ref(false)

function reload() {
  window.location.reload()
}
</script>

<template>
  <div
    v-if="available && !later"
    role="status"
    class="pointer-events-auto w-fit max-w-full"
  >
    <UAlert
      color="info"
      variant="solid"
      icon="i-lucide-refresh-cw"
      title="A new version of the app is ready"
      description="Reload to get it. It also updates when you open another page."
      orientation="horizontal"
      :actions="[
        { label: 'Later', color: 'neutral', variant: 'link', class: 'text-inverted', onClick: () => { later = true } },
        { label: 'Reload', color: 'neutral', variant: 'solid', onClick: reload },
      ]"
    />
  </div>
</template>
