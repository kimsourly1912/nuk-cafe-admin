<script setup lang="ts">
// Keyboard shortcut list. Opened with `?` or from the user menu (layouts/default.vue).
</script>

<template>
  <UModal title="Keyboard shortcuts">
    <template #body>
      <ul class="divide-y divide-default">
        <li
          v-for="shortcut in SHORTCUTS"
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
  </UModal>
</template>
