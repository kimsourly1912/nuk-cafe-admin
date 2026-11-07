<script setup lang="ts">
/**
 * The sticky category bar (D93): "All categories" on the left (a popover from `sm`, an icon button
 * and a bottom sheet on phones), then the main categories as flat tabs that scroll sideways. The
 * active tab follows the section being read and scrolls itself into view; choosing a tab or a tree
 * entry scrolls the menu there. Which trigger shows is CSS (both are rendered, each opens its own
 * overlay), so the server's page and the browser's agree (D95).
 */
import type { MenuSection } from '../utils/menu'
import MenuCategoryTree from './MenuCategoryTree.vue'

const props = defineProps<{
  sections: MenuSection[]
  activeMainId?: string
  activeSubId?: string
}>()
const emit = defineEmits<{ go: [id: string] }>()

const sheetOpen = ref(false)
const popoverOpen = ref(false)
const tabs = computed(() => props.sections.map(section => ({ id: section.id, label: section.name })))
/**
 * Closing the tree would return focus to its button, and a focus change can stop the smooth scroll
 * that just started. Focus goes to the chosen section instead (`useScrollSpy`).
 */
const keepFocus = (event: Event) => event.preventDefault()

function go(id: string) {
  sheetOpen.value = false
  popoverOpen.value = false
  emit('go', id)
}
</script>

<template>
  <div class="flex items-center gap-2">
    <AppDrawer
      v-model:open="sheetOpen"
      title="Categories"
      :content="{ onCloseAutoFocus: keepFocus }"
      :ui="{ content: 'max-h-[70dvh]' }"
    >
      <UButton
        icon="i-lucide-list"
        color="neutral"
        :variant="sheetOpen ? 'soft' : 'ghost'"
        aria-label="All categories"
        class="sm:hidden"
      />
      <template #body>
        <MenuCategoryTree
          :sections="sections"
          :active-main-id="activeMainId"
          :active-sub-id="activeSubId"
          @go="go"
        />
      </template>
    </AppDrawer>
    <UPopover
      v-model:open="popoverOpen"
      :content="{ align: 'start', onCloseAutoFocus: keepFocus }"
    >
      <UButton
        label="All categories"
        icon="i-lucide-list"
        trailing-icon="i-lucide-chevron-down"
        color="neutral"
        variant="ghost"
        class="shrink-0 max-sm:hidden"
      />
      <template #content>
        <div class="max-h-[min(26rem,70dvh)] w-72 overflow-y-auto p-2">
          <MenuCategoryTree
            :sections="sections"
            :active-main-id="activeMainId"
            :active-sub-id="activeSubId"
            @go="go"
          />
        </div>
      </template>
    </UPopover>

    <PillNav
      :items="tabs"
      :active-id="activeMainId"
      aria-label="Categories"
      class="flex-1"
      @select="go"
    />
  </div>
</template>
