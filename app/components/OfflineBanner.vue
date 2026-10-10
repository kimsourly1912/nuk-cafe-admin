<script setup lang="ts">
import { useOnline } from '@vueuse/core'

/** Shown while the browser is offline. Mounted once in app.vue, which places it at the bottom. Data refreshes on reconnect (plugins/data-freshness). */
const online = useOnline()
</script>

<template>
  <div
    v-if="!online"
    role="status"
    class="pointer-events-auto w-fit max-w-full"
  >
    <UAlert
      color="warning"
      variant="solid"
      icon="i-lucide-wifi-off"
      title="You're offline"
      description="Changes can't be saved until the connection is back."
    />
  </div>
</template>
