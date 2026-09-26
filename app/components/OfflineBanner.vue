<script setup lang="ts">
import { useOnline } from '@vueuse/core'

/** Shown while the browser is offline. Mounted once in app.vue. Data refreshes on reconnect (plugins/data-freshness). */
const online = useOnline()
</script>

<template>
  <div
    v-if="!online"
    role="status"
    class="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit max-w-[calc(100%-2rem)]"
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
