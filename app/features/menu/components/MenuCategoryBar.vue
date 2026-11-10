<script setup lang="ts">
/**
 * The sticky category bar (D93): "All categories" on the left (a popover from `sm`, an icon button
 * and a bottom sheet on phones), then the main categories as flat tabs that scroll sideways. The
 * active tab follows the section being read and scrolls itself into view; choosing a tab or a tree
 * entry scrolls the menu there. Which trigger shows is CSS (both are rendered, each opens its own
 * overlay), so the server's page and the browser's agree (D95).
 */
import { usePreferredReducedMotion, useResizeObserver } from '@vueuse/core'
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
const motion = usePreferredReducedMotion()
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

const strip = useTemplateRef<HTMLElement>('strip')
const findTab = (id?: string) => strip.value?.querySelector<HTMLElement>(`[data-section="${id}"]`) ?? null

// The highlight is one pill that slides to the active tab (position and width in the strip's own
// scroll coordinates, so it follows the tabs when the strip scrolls). Until the browser has placed
// it, the active tab paints its own background (server render), and the first placement is not
// animated.
const marker = ref<{ left: number, width: number } | null>(null)
const animated = ref(false)

function placeMarker() {
  const tab = findTab(props.activeMainId)
  marker.value = tab ? { left: tab.offsetLeft, width: tab.offsetWidth } : null
}

// Keep the active tab in view: scroll the tab strip only (never the page).
function centreTab() {
  const tab = findTab(props.activeMainId)
  if (!strip.value || !tab) return
  const left = tab.offsetLeft - (strip.value.clientWidth - tab.offsetWidth) / 2
  strip.value.scrollTo({ left: Math.max(0, left), behavior: motion.value === 'reduce' ? 'auto' : 'smooth' })
}

watch(() => props.activeMainId, async () => {
  await nextTick()
  placeMarker()
  centreTab()
})
onMounted(() => {
  placeMarker()
  requestAnimationFrame(() => {
    animated.value = true
  })
})
// Tabs change width with the sections, the font loading or the window.
useResizeObserver(strip, placeMarker)
watch(() => props.sections, async () => {
  await nextTick()
  placeMarker()
})
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

    <nav
      ref="strip"
      aria-label="Categories"
      class="relative flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]"
    >
      <span
        v-if="marker"
        aria-hidden="true"
        class="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-primary/10"
        :class="animated && 'transition-[transform,width] duration-300 ease-out motion-reduce:transition-none'"
        :style="{ width: `${marker.width}px`, transform: `translateX(${marker.left}px)` }"
      />
      <UButton
        v-for="section in sections"
        :key="section.id"
        :data-section="section.id"
        :label="section.name"
        :color="section.id === activeMainId ? 'primary' : 'neutral'"
        variant="ghost"
        :aria-current="section.id === activeMainId ? 'true' : undefined"
        class="relative shrink-0 rounded-full px-4 transition-colors duration-200 motion-reduce:transition-none"
        :class="!marker && section.id === activeMainId && 'bg-primary/10'"
        @click="go(section.id)"
      />
    </nav>
  </div>
</template>
