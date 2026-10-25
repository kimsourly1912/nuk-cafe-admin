<script setup lang="ts">
/**
 * The resize handle on a `UDashboardSidebar`'s edge, for its `resize-handle` slot. A click collapses
 * or expands the sidebar; a press that moves past `CLICK_SLOP` becomes a drag and hands over to
 * Nuxt UI's own resize (passed in). The state is the sidebar's `collapsed` model, so Ctrl/⌘+B and a
 * drag that snaps the sidebar shut stay in step with it.
 *
 * Nuxt UI resizes from the first pixel of movement, which made a click on the collapsed rail expand
 * it mid-press (then the release collapsed it again), so the resize starts only once it is a drag.
 * There is no double-click reset: it would toggle twice first.
 *
 * @example
 * <template #resize-handle="{ onMouseDown, onTouchStart, ui }">
 *   <SidebarResizeHandle
 *     v-model:collapsed="sidebarCollapsed"
 *     :handle-class="ui.handle()"
 *     :on-mouse-down="onMouseDown"
 *     :on-touch-start="onTouchStart"
 *   />
 * </template>
 */
const props = defineProps<{
  handleClass: string
  onMouseDown: (e: MouseEvent) => void
  onTouchStart: (e: TouchEvent) => void
}>()
const collapsed = defineModel<boolean>('collapsed', { default: false })

/** Further than this and the press is a drag, not a click. */
const CLICK_SLOP = 4

let release: AbortController | undefined
onBeforeUnmount(() => release?.abort())

/** Follows one press: starts the resize once it moves past the slop, toggles if it never did. */
function press(startX: number, startResize: () => void, kind: 'mouse' | 'touch') {
  release?.abort()
  const current = new AbortController()
  release = current
  const { signal } = current
  let dragging = false
  const move = (e: Event) => {
    const x = e instanceof MouseEvent ? e.clientX : (e as TouchEvent).touches[0]?.clientX
    if (dragging || x === undefined || Math.abs(x - startX) < CLICK_SLOP) return
    dragging = true
    startResize()
  }
  const end = (e: Event) => {
    current.abort()
    if (!dragging && e.type !== 'touchcancel') collapsed.value = !collapsed.value
  }
  if (kind === 'mouse') {
    document.addEventListener('mousemove', move, { signal })
    document.addEventListener('mouseup', end, { signal })
  }
  else {
    document.addEventListener('touchmove', move, { signal })
    document.addEventListener('touchend', end, { signal })
    document.addEventListener('touchcancel', end, { signal })
  }
}

function pressMouse(e: MouseEvent) {
  if (e.button !== 0) return
  e.preventDefault() // no text selection while pressing
  press(e.clientX, () => props.onMouseDown(e), 'mouse')
}

function pressTouch(e: TouchEvent) {
  const touch = e.touches[0]
  if (!touch || e.touches.length > 1) return
  e.preventDefault() // no emulated mouse events after the touch
  press(touch.clientX, () => props.onTouchStart(e), 'touch')
}
</script>

<template>
  <UDashboardResizeHandle
    :class="handleClass"
    :title="collapsed ? 'Click to expand, drag to resize' : 'Click to collapse, drag to resize'"
    @mousedown="pressMouse"
    @touchstart="pressTouch"
  />
</template>
