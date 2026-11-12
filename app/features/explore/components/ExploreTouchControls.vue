<script setup lang="ts">
import type { Actions } from '../runtime/actions'

/**
 * Explore's touch controls (D275, docs/plans/explore.md → Controls): a floating thumbstick that
 * appears where the thumb lands in the left half, held at its rim for a moment to sprint, and
 * dragging in the right half to look. Each finger is tracked by its pointer; lifting or a cancelled
 * touch lets go. Buttons (Jump, the context action) sit above this layer.
 */

const { actions, passenger, moto } = defineProps<{ actions: Actions, passenger: boolean, moto: boolean }>()

/** Radians a pixel of drag turns the camera. */
const TOUCH_LOOK = 0.0055
/** The stick's reach, CSS pixels. */
const RADIUS = 56
const SPRINT_HOLD_MS = 300

const root = useTemplateRef<HTMLElement>('root')
const stick = ref<{ id: number, x: number, y: number, dx: number, dy: number } | null>(null)
let lookPointer: { id: number, x: number, y: number } | null = null
let rimSince: number | null = null
let rimTimer: ReturnType<typeof setTimeout> | undefined

function apply() {
  const current = stick.value
  if (!current) {
    actions.stick(null)
    return
  }
  const tilt = Math.min(1, Math.hypot(current.dx, current.dy) / RADIUS)
  const now = performance.now()
  if (!moto && tilt >= 0.95) rimSince ??= now
  else rimSince = null
  const sprint = rimSince !== null && now - rimSince >= SPRINT_HOLD_MS
  actions.stick({ x: current.dx / RADIUS, y: -current.dy / RADIUS }, sprint)
  clearTimeout(rimTimer)
  // Still at the rim without moving: sprint once the hold is long enough.
  if (rimSince !== null && !sprint) rimTimer = setTimeout(apply, SPRINT_HOLD_MS - (now - rimSince))
}

function down(event: PointerEvent) {
  if (event.pointerType === 'mouse' || !root.value) return
  const box = root.value.getBoundingClientRect()
  const x = event.clientX - box.left
  const y = event.clientY - box.top
  if (!passenger && x < box.width / 2 && !stick.value) {
    stick.value = { id: event.pointerId, x, y, dx: 0, dy: 0 }
  }
  else if ((passenger || x >= box.width / 2) && !lookPointer) {
    lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }
  else {
    return
  }
  root.value.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function move(event: PointerEvent) {
  if (stick.value?.id === event.pointerId && root.value) {
    const box = root.value.getBoundingClientRect()
    let dx = event.clientX - box.left - stick.value.x
    let dy = event.clientY - box.top - stick.value.y
    if (moto) dy = 0
    const size = Math.hypot(dx, dy)
    if (size > RADIUS) {
      dx = (dx / size) * RADIUS
      dy = (dy / size) * RADIUS
    }
    stick.value = { ...stick.value, dx, dy }
    apply()
  }
  else if (lookPointer?.id === event.pointerId) {
    actions.look((event.clientX - lookPointer.x) * TOUCH_LOOK, (event.clientY - lookPointer.y) * TOUCH_LOOK)
    lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }
}

function up(event: PointerEvent) {
  if (stick.value?.id === event.pointerId) {
    stick.value = null
    rimSince = null
    clearTimeout(rimTimer)
    apply()
  }
  if (lookPointer?.id === event.pointerId) lookPointer = null
}

watch([() => passenger, () => moto], () => {
  stick.value = null
  lookPointer = null
  rimSince = null
  clearTimeout(rimTimer)
  actions.stick(null)
})

onBeforeUnmount(() => {
  clearTimeout(rimTimer)
  actions.stick(null)
})
</script>

<template>
  <div
    ref="root"
    class="absolute inset-0 touch-none select-none"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @lostpointercapture="up"
  >
    <div
      v-if="stick"
      class="pointer-events-none absolute size-28 -translate-x-1/2 -translate-y-1/2 rounded-full bg-default/40 ring-2 ring-default"
      :style="{ left: `${stick.x}px`, top: `${stick.y}px` }"
      aria-hidden="true"
    >
      <div
        class="absolute top-1/2 left-1/2 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-default/90 ring-1 ring-default"
        :style="{ transform: `translate(calc(-50% + ${stick.dx}px), calc(-50% + ${stick.dy}px))` }"
      />
    </div>
    <div
      v-else-if="!passenger"
      class="pointer-events-none absolute bottom-48 left-8 size-28 rounded-full bg-default/25 ring-2 ring-default/60"
      aria-hidden="true"
    >
      <div class="absolute top-1/2 left-1/2 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-default/60" />
    </div>
  </div>
</template>
