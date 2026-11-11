<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import type { ExploreBranch } from '../composables/useExploreBranches'
import type { LocationState } from '../composables/useExploreLocation'
import type { MapColors } from '../runtime/map-draw'
import { drawMap, drawOverview } from '../runtime/map-draw'
import type { NetworkBranch, Pin } from '../runtime/network'
import { distance } from '../runtime/vec'
import type { ExploreWorld, RideStopOption } from '../runtime/world'
import ExploreBranchList from './ExploreBranchList.vue'

/**
 * The full map (D275, docs/plans/explore.md → Full map): north up, dragged to pan, wheel or pinch
 * to zoom, with the café and its actions beside it (below on phones). With the cafe's branches in
 * Explore (step E4) it has two levels, **This street** and **All branches** (each branch at its real
 * position, joined by its gateways), and the branch list. The world is paused while it is open (the
 * page does that), so it draws only when the view changes. Back closes it (AppModal).
 */

const props = defineProps<{
  world: ExploreWorld
  colors: MapColors
  /** The district shown (it changes at a gateway). */
  placeId: string
  waypointId: string | null
  canCallRide: boolean
  /** Step E4: the branches in Explore and their chain; empty on the demo street. */
  branches: readonly ExploreBranch[]
  chain: readonly NetworkBranch[]
  location: LocationState
  position: Pin | null
}>()
const emit = defineEmits<{ waypoint: [id: string | null], menu: [id: string], street: [], callRide: [], ride: [stopId: string], locate: [] }>()
const open = defineModel<boolean>('open', { required: true })

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const frame = useTemplateRef<HTMLElement>('frame')
const view = reactive({ scale: 10, x: 0, z: 0 })
const level = ref<'street' | 'overview'>('street')
const levels = [{ label: 'This street', value: 'street' }, { label: 'All branches', value: 'overview' }]
const pointers = new Map<number, { x: number, y: number }>()
let pinch: { distance: number, scale: number } | null = null
let pending = 0

// Read again whenever the district changes (`placeId`): the world swaps it at a gateway.
const district = computed(() => {
  void props.placeId
  return props.world.district()
})
const networked = computed(() => props.chain.length > 0)
const rideStops = ref<RideStopOption[]>([])
const away = computed(() => {
  const door = district.value.entrance
  return door ? Math.round(distance(props.world.mapView().player.position, door.mid)) : null
})

function fit() {
  const box = frame.value?.getBoundingClientRect()
  const { minX, maxX, minZ, maxZ } = district.value.bounds
  view.x = (minX + maxX) / 2
  view.z = (minZ + maxZ) / 2
  if (box) view.scale = Math.min(box.width / (maxX - minX), box.height / (maxZ - minZ)) * 0.92
  schedule()
}

function centerOnMe() {
  const player = props.world.mapView().player.position
  view.x = player.x
  view.z = player.z
  level.value = 'street'
  schedule()
}

function schedule() {
  if (pending) return
  pending = requestAnimationFrame(() => {
    pending = 0
    draw()
  })
}

function draw() {
  const element = canvas.value
  const box = frame.value?.getBoundingClientRect()
  const context = element?.getContext('2d')
  if (!element || !box || !context || !box.width || !box.height) return
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  element.width = Math.round(box.width * ratio)
  element.height = Math.round(box.height * ratio)
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  if (level.value === 'overview') {
    drawOverview(context, props.chain, { width: box.width, height: box.height, colors: props.colors, currentId: props.placeId, waypointId: props.waypointId })
    return
  }
  drawMap(context, district.value, props.world.mapView(), { width: box.width, height: box.height, scale: view.scale, center: { x: view.x, z: view.z }, rotation: 0, colors: props.colors, labels: true })
}

function zoom(factor: number) {
  view.scale = Math.max(3, Math.min(60, view.scale * factor))
  schedule()
}

function down(event: PointerEvent) {
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    pinch = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: view.scale }
  }
}

function move(event: PointerEvent) {
  const before = pointers.get(event.pointerId)
  if (!before || level.value === 'overview') return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()]
    view.scale = Math.max(3, Math.min(60, pinch.scale * (Math.hypot(a!.x - b!.x, a!.y - b!.y) / pinch.distance)))
  }
  else if (pointers.size === 1) {
    view.x -= (event.clientX - before.x) / view.scale
    view.z -= (event.clientY - before.y) / view.scale
  }
  schedule()
}

function up(event: PointerEvent) {
  pointers.delete(event.pointerId)
  if (pointers.size < 2) pinch = null
}

function wheel(event: WheelEvent) {
  if (level.value === 'street') zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15)
}

useResizeObserver(frame, schedule)
watch(open, (value) => {
  if (!value) return
  rideStops.value = props.world.rideStops()
  level.value = 'street'
  nextTick(fit)
})
watch(() => [props.colors, props.waypointId, props.placeId, level.value], schedule)
onBeforeUnmount(() => cancelAnimationFrame(pending))
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Map"
    :description="networked ? 'The street you\'re on and the cafe\'s branches. Drag to move the map; pinch or scroll to zoom.' : 'The street around the café. Drag to move the map; pinch or scroll to zoom.'"
    fullscreen
    :ui="{ body: 'flex min-h-0 flex-1 flex-col p-0 sm:p-0 lg:flex-row' }"
  >
    <template #body>
      <div
        ref="frame"
        class="relative min-h-64 flex-1 touch-none overflow-hidden bg-muted"
      >
        <canvas
          ref="canvas"
          class="absolute inset-0 size-full"
          :class="level === 'street' ? 'cursor-grab active:cursor-grabbing' : ''"
          role="img"
          :aria-label="level === 'street' ? `Map of the street around ${district.name}` : `Map of the cafe's ${chain.length} branches in Explore`"
          @pointerdown="down"
          @pointermove="move"
          @pointerup="up"
          @pointercancel="up"
          @wheel.prevent="wheel"
        />
        <UTabs
          v-if="networked"
          v-model="level"
          :items="levels"
          :content="false"
          size="sm"
          class="absolute top-3 left-3"
          aria-label="Map level"
        />
        <div
          v-if="level === 'street'"
          class="absolute top-3 right-3 flex flex-col gap-2"
        >
          <UButton
            icon="i-lucide-plus"
            color="neutral"
            variant="soft"
            aria-label="Zoom in"
            @click="zoom(1.3)"
          />
          <UButton
            icon="i-lucide-minus"
            color="neutral"
            variant="soft"
            aria-label="Zoom out"
            @click="zoom(1 / 1.3)"
          />
          <UButton
            icon="i-lucide-locate-fixed"
            color="neutral"
            variant="soft"
            aria-label="Center on me"
            @click="centerOnMe"
          />
        </div>
      </div>
      <div class="max-h-[50dvh] space-y-4 overflow-y-auto border-t border-default p-4 lg:max-h-none lg:w-96 lg:border-t-0 lg:border-l">
        <ExploreBranchList
          v-if="networked"
          :branches="branches"
          :current-id="placeId"
          :waypoint-id="waypointId"
          :location="location"
          :position="position"
          :ride-stops="rideStops"
          :can-ride="canCallRide"
          @waypoint="id => emit('waypoint', id)"
          @ride="stopId => emit('ride', stopId)"
          @menu="id => emit('menu', id)"
          @locate="emit('locate')"
        />
        <template v-else>
          <div class="space-y-1">
            <h3 class="font-semibold text-highlighted">
              {{ district.name }}
            </h3>
            <p class="text-sm text-muted">
              {{ away === null ? 'On this street' : `About ${away} m from you` }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="waypointId !== placeId"
              icon="i-lucide-map-pin"
              label="Set waypoint"
              @click="emit('waypoint', placeId)"
            />
            <UButton
              v-else
              icon="i-lucide-map-pin-off"
              label="Clear waypoint"
              color="neutral"
              variant="outline"
              @click="emit('waypoint', null)"
            />
            <UButton
              icon="i-lucide-coffee"
              label="View menu"
              color="neutral"
              variant="outline"
              @click="emit('menu', placeId)"
            />
          </div>
        </template>
        <USeparator />
        <UButton
          v-if="canCallRide"
          icon="i-lucide-car-front"
          label="Call tuk-tuk"
          color="neutral"
          variant="outline"
          @click="emit('callRide')"
        />
        <div class="space-y-1">
          <UButton
            icon="i-lucide-undo-2"
            label="Return to street"
            color="neutral"
            variant="ghost"
            @click="emit('street')"
          />
          <p class="text-sm text-muted">
            Stuck? This puts you back across the street from the café.
          </p>
        </div>
      </div>
    </template>
  </AppModal>
</template>
