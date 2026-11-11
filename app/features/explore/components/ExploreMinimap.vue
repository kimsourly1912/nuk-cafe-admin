<script setup lang="ts">
import type { MapColors } from '../runtime/map-draw'
import { drawMap } from '../runtime/map-draw'
import type { ExploreWorld } from '../runtime/world'

/**
 * The minimap (D275, docs/plans/explore.md → Minimap): a circle centred on the player that turns
 * with the camera, with N on its rim, the route and the waypoint. It draws after the world's frames,
 * at most 30 times a second. A tap opens the full map.
 */

const { world, colors } = defineProps<{ world: ExploreWorld, colors: MapColors }>()
defineEmits<{ open: [] }>()

/** CSS pixels across, and metres across. */
const SIZE = 128
const METRES = 34

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
let lastDraw = 0

function draw() {
  const element = canvas.value
  const context = element?.getContext('2d')
  if (!element || !context) return
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  if (element.width !== SIZE * ratio) {
    element.width = SIZE * ratio
    element.height = SIZE * ratio
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  const view = world.mapView()
  drawMap(context, world.district, view, { width: SIZE, height: SIZE, scale: SIZE / METRES, center: view.player.position, rotation: view.cameraYaw, colors })
  // North on the rim, where the world's −z falls on this turned map.
  const radius = SIZE / 2 - 11
  const x = SIZE / 2 + Math.sin(view.cameraYaw) * radius
  const y = SIZE / 2 - Math.cos(view.cameraYaw) * radius
  context.fillStyle = colors.outline
  context.beginPath()
  context.arc(x, y, 8, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = colors.text
  context.font = '600 10px system-ui, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('N', x, y + 0.5)
}

let stop: (() => void) | undefined
onMounted(() => {
  draw()
  stop = world.onFrame(() => {
    const now = performance.now()
    if (now - lastDraw < 33) return
    lastDraw = now
    draw()
  })
})
watch(() => colors, draw)
onBeforeUnmount(() => stop?.())
</script>

<template>
  <button
    type="button"
    class="block size-32 overflow-hidden rounded-full bg-default ring-2 ring-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    aria-label="Open the map"
    @click="$emit('open')"
  >
    <canvas
      ref="canvas"
      class="block size-32"
      aria-hidden="true"
    />
  </button>
</template>
