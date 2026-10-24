<script setup lang="ts">
// Keyboard shortcut list. Opened with `?` or from the user menu (layouts/default.vue, layouts/platform.vue).
withDefaults(defineProps<{
  /** The shell's own list: the admin's by default, `PLATFORM_SHORTCUTS` in the platform console. */
  shortcuts?: readonly { kbds: readonly string[], label: string }[]
}>(), { shortcuts: () => SHORTCUTS })
</script>

<template>
  <AppModal title="Keyboard shortcuts">
    <template #body>
      <ul class="divide-y divide-default">
        <li
          v-for="shortcut in shortcuts"
          :key="shortcut.label"
          class="flex items-center justify-between gap-4 py-2 text-sm"
        >
          <span>{{ shortcut.label }}</span>
          <span class="flex shrink-0 gap-1">
            <UKbd
              v-for="kbd in shortcut.kbds"
              :key="kbd"
              :value="kbd"
            />
          </span>
        </li>
      </ul>
    </template>
  </AppModal>
</template>
