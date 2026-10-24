<script setup lang="ts">
// "Install app" from the counter's or the admin's user menu (D203), where the browser can't
// install by itself: the steps for this device. Opened by `useInstallApp`.
defineProps<{
  /** The installed app's name, as its manifest gives it ("NUK Cafe Counter"). */
  appName: string
  platform: InstallPlatform
}>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <AppModal
    :title="`Install ${appName}`"
    description="Open it from its own icon, full screen, without the browser's address bar."
  >
    <template #body>
      <ol class="list-decimal space-y-2 ps-5 text-sm">
        <li
          v-for="step in INSTALL_STEPS[platform]"
          :key="step"
        >
          {{ step }}
        </li>
      </ol>
      <p class="mt-4 text-sm text-muted">
        It still needs the internet: without a connection nothing can be saved.
      </p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end">
        <UButton
          label="Got it"
          @click="emit('close')"
        />
      </div>
    </template>
  </AppModal>
</template>
