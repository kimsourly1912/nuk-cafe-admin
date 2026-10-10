<script setup lang="ts">
import { useWakeLock } from '@vueuse/core'

/**
 * The counter workspace's shell (D102): no sidebar; each page brings its header.
 *
 * The screen stays on while a counter page is open (D149): a tablet that dims or locks between
 * customers misses the new-order chime and badge. The browser drops the lock when the tab is
 * hidden and VueUse asks again when it's visible. Refused (battery saver, an older browser):
 * nothing changes.
 */
// A swipe can't reload the page or go back mid-payment on a tablet: pull-to-refresh and swipe
// navigation come from overscrolling the page, which the counter turns off (D150).
useHead({ htmlAttrs: { class: 'overscroll-none' }, bodyAttrs: { class: 'overscroll-none' } })

const wakeLock = useWakeLock()
onMounted(() => {
  if (wakeLock.isSupported.value) wakeLock.request('screen').catch(() => {})
})
</script>

<template>
  <div class="min-h-dvh bg-muted">
    <slot />
  </div>
</template>
