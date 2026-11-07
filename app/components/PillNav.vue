<script setup lang="ts">
/**
 * Choices as a row of pill buttons that scrolls sideways (D93, shared since D270): the customer
 * menu's main categories, and the Categories page's below `lg`. The highlight is one pill that slides
 * to the active button, in the row's own scroll coordinates so it follows the buttons when the row
 * scrolls. Until the browser has placed it, the active button paints its own background (server
 * render), and the first placement isn't animated. The active button is kept in view: only the row
 * scrolls, never the page. The row may start hidden: it settles once it has a size.
 *
 * @example
 * <PillNav :items="sections.map(s => ({ id: s.id, label: s.name }))" :active-id="activeId" aria-label="Categories" @select="go" />
 */
import { usePreferredReducedMotion, useResizeObserver } from '@vueuse/core'

const props = defineProps<{
  items: { id: string, label: string }[]
  activeId?: string
}>()
defineEmits<{ select: [id: string] }>()

const motion = usePreferredReducedMotion()
const strip = useTemplateRef<HTMLElement>('strip')
const findPill = (id?: string) => strip.value?.querySelector<HTMLElement>(`[data-pill="${id}"]`) ?? null

const marker = ref<{ left: number, width: number } | null>(null)
const animated = ref(false)

function placeMarker() {
  const pill = findPill(props.activeId)
  marker.value = pill ? { left: pill.offsetLeft, width: pill.offsetWidth } : null
}

function centrePill(smooth: boolean) {
  const pill = findPill(props.activeId)
  if (!strip.value || !pill) return
  const left = pill.offsetLeft - (strip.value.clientWidth - pill.offsetWidth) / 2
  strip.value.scrollTo({ left: Math.max(0, left), behavior: smooth && motion.value !== 'reduce' ? 'smooth' : 'auto' })
}

watch(() => props.activeId, async () => {
  await nextTick()
  placeMarker()
  centrePill(true)
})
onMounted(() => {
  placeMarker()
  requestAnimationFrame(() => {
    animated.value = true
  })
})
// Pills change width with the items, the font loading or the window. The first time the row has a
// size (it may have been hidden), the active pill is put in view at once.
let settled = false
useResizeObserver(strip, () => {
  placeMarker()
  if (settled || !strip.value?.clientWidth) return
  settled = true
  centrePill(false)
})
watch(() => props.items, async () => {
  await nextTick()
  placeMarker()
})
</script>

<template>
  <nav
    ref="strip"
    class="relative flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]"
  >
    <span
      v-if="marker"
      aria-hidden="true"
      class="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-primary/10"
      :class="animated && 'transition-[transform,width] duration-300 ease-out motion-reduce:transition-none'"
      :style="{ width: `${marker.width}px`, transform: `translateX(${marker.left}px)` }"
    />
    <UButton
      v-for="item in items"
      :key="item.id"
      :data-pill="item.id"
      :label="item.label"
      :color="item.id === activeId ? 'primary' : 'neutral'"
      variant="ghost"
      :aria-current="item.id === activeId ? 'true' : undefined"
      class="relative shrink-0 rounded-full px-4 transition-colors duration-200 motion-reduce:transition-none"
      :class="!marker && item.id === activeId && 'bg-primary/10'"
      @click="$emit('select', item.id)"
    />
  </nav>
</template>
