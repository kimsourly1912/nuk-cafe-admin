<script setup lang="ts">
/**
 * Studio's Manage looks panel (D277): the Furniture looks list in the sidebar, so a look is edited
 * or deleted without leaving the layout draft. It uses the same queries and mutations as the page.
 * A change invalidates `branches`, so the open layout picks up the edited look.
 */
import { useLookCatalog } from '../composables/useLookCatalog'
import LooksLibrary from './LooksLibrary.vue'

const catalog = useLookCatalog()
</script>

<template>
  <div class="flex flex-col gap-4">
    <UDropdownMenu
      :items="catalog.newItems.value"
      :content="{ align: 'start' }"
    >
      <UButton
        label="New look"
        icon="i-lucide-plus"
        trailing-icon="i-lucide-chevron-down"
        color="neutral"
        variant="outline"
        class="self-start"
        :disabled="catalog.loading.value || Boolean(catalog.error.value)"
      />
    </UDropdownMenu>
    <LooksLibrary
      :catalog="catalog"
      :section-actions="false"
      :heading-level="3"
    />
  </div>
</template>
