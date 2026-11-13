<script setup lang="ts">
import type { CommandPaletteGroup } from '@nuxt/ui'

/**
 * Studio's command search (Ctrl/⌘+/, owner 2026-11-13, like Figma's quick actions): every action
 * Studio has, found by typing. Choosing one closes the search and runs it. The editor builds the
 * groups, so an action here is the same one its key or menu runs.
 */
defineProps<{ groups: CommandPaletteGroup[] }>()
const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Search actions"
    description="Type to find a Studio action, then press Enter."
    :ui="{ content: 'p-0', header: 'sr-only', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <UCommandPalette
        :groups="groups"
        placeholder="Search actions…"
        class="h-96"
        data-testid="studio-commands"
        @update:model-value="open = false"
      />
    </template>
  </AppModal>
</template>
