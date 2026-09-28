<script setup lang="ts">
/**
 * The one bottom action bar (D77 decision 3, D78): a page's mode bar, Save bar or bulk bar. Features
 * supply ordinary Nuxt UI buttons; the bar owns only where it sits and how it stays out of the way:
 *
 * - **Below `lg`** it's fixed to the bottom of the screen, full width, above the home indicator
 *   (safe-area padding). While it shows, its scroll container gets matching bottom padding (the last
 *   content is never under it) and `scroll-padding-bottom` (a focused field is never scrolled under it).
 *   While a text field elsewhere has focus (an on-screen keyboard), it steps aside.
 * - **From `lg`**, `expanded` decides: `inline` sits where the bar is placed (above the content),
 *   `pinned` sticks to the bottom of the panel (place it last in the body), `hidden` isn't shown (the
 *   page has the action elsewhere, e.g. in the navbar).
 * - **Only one bar shows at a time**: the most recently opened one.
 *
 * `max-lg:m-0`: a parent's `space-y-*` margin would otherwise lift the fixed bar off the bottom edge.
 * It adds no colors, radius, shadows or button styles of its own beyond Nuxt UI's surface tokens.
 *
 * @example
 * <BottomActionBar label="Reorder" :open="mode === 'reorder'">
 *   <p class="min-w-0 flex-1 text-sm text-muted">Drag a row or use its arrows.</p>
 *   <UButton label="Save order" @click="save" />
 * </BottomActionBar>
 */
import { useElementSize } from '@vueuse/core'

const props = withDefaults(defineProps<{
  /** The toolbar's accessible name ("Bulk actions", "Reorder"). */
  label: string
  open?: boolean
  expanded?: 'inline' | 'pinned' | 'hidden'
}>(), { open: true, expanded: 'inline' })

const id = useId()
const { isExpanded } = useLayoutContext()

// One bar at a time, app-wide: the last one that wants to show wins.
const stack = useState<string[]>('bottom-action-bar:stack', () => [])
const wants = computed(() => props.open && !(isExpanded.value && props.expanded === 'hidden'))
function leave() {
  stack.value = stack.value.filter(entry => entry !== id)
}
watch(wants, (want) => {
  leave()
  if (want) stack.value = [...stack.value, id]
}, { immediate: true })
onBeforeUnmount(leave)
const active = computed(() => stack.value.at(-1) === id)

const bar = useTemplateRef<HTMLElement>('bar')
const fixed = computed(() => !isExpanded.value)

// An on-screen keyboard: a text field outside the bar has focus.
const typing = ref(false)
function onFocusChange() {
  const focused = document.activeElement
  typing.value = isTextEntry(focused) && !bar.value?.contains(focused)
}
// `focusout` runs before focus lands elsewhere: check once it has, so moving from one field to the
// next doesn't flash the bar.
function onFocusOut() {
  requestAnimationFrame(onFocusChange)
}
onMounted(() => {
  onFocusChange()
  document.addEventListener('focusin', onFocusChange)
  document.addEventListener('focusout', onFocusOut)
})
onBeforeUnmount(() => {
  document.removeEventListener('focusin', onFocusChange)
  document.removeEventListener('focusout', onFocusOut)
})

const shown = computed(() => active.value && !(fixed.value && typing.value))

// While it's fixed, its scroll container makes room for it. The room stays while the bar steps aside
// for the keyboard (height 0), so the content doesn't jump under the user's finger.
const { height } = useElementSize(bar, undefined, { box: 'border-box' })
/** The container while the bar makes room in it, with its own inline styles (restored later). */
let room: { container: HTMLElement, padding: string, scrollPadding: string } | undefined

function scrollContainerOf(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : undefined
}
function releaseRoom() {
  if (!room) return
  room.container.style.paddingBottom = room.padding
  room.container.style.scrollPaddingBottom = room.scrollPadding
  room = undefined
}
function makeRoom(barHeight: number) {
  if (!bar.value) return
  if (!room) {
    const container = scrollContainerOf(bar.value)
    if (!container) return
    room = { container, padding: container.style.paddingBottom, scrollPadding: container.style.scrollPaddingBottom }
  }
  // The container's own padding (Nuxt UI's, per width) plus the bar.
  room.container.style.paddingBottom = room.padding
  const basePadding = getComputedStyle(room.container).paddingBottom
  room.container.style.paddingBottom = `calc(${basePadding} + ${barHeight}px)`
  room.container.style.scrollPaddingBottom = `${barHeight}px`
}
watch([active, fixed, height], ([isActive, isFixed, barHeight]) => {
  if (!isActive || !isFixed) releaseRoom()
  else if (barHeight > 0) makeRoom(barHeight)
}, { flush: 'post' })
onBeforeUnmount(releaseRoom)
</script>

<template>
  <div
    v-if="active"
    v-show="shown"
    ref="bar"
    role="toolbar"
    :aria-label="label"
    class="fixed inset-x-0 bottom-0 z-30 max-lg:m-0 flex flex-wrap items-center gap-2 border-t border-default bg-default px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
    :class="{
      'lg:static lg:z-auto lg:rounded-lg lg:border lg:bg-elevated/40 lg:px-3 lg:py-2': expanded === 'inline',
      'lg:sticky lg:bottom-4 lg:mx-auto lg:w-fit lg:rounded-lg lg:border lg:px-3 lg:py-2': expanded === 'pinned',
      'lg:hidden': expanded === 'hidden',
    }"
  >
    <slot />
  </div>
</template>
