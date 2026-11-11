<script setup lang="ts">
import { useMediaQuery, useTimeoutFn } from '@vueuse/core'
import { DEMO_CAFE_NAME, DEMO_SEED, DEMO_TABLES, demoCafe } from '../demo/demo-cafe'
import type { WalkReport } from '../runtime/bench'
import { formatWalkReport } from '../runtime/bench'
import { attachDesktopInput } from '../runtime/desktop-input'
import type { MapColors } from '../runtime/map-draw'
import { readMapColors } from '../runtime/map-draw'
import type { ExploreWorld, Prompt, Status } from '../runtime/world'
import ExploreFullMap from './ExploreFullMap.vue'
import ExploreMinimap from './ExploreMinimap.vue'
import ExploreRidePicker from './ExploreRidePicker.vue'
import ExploreTouchControls from './ExploreTouchControls.vue'

/**
 * Explore (D275, docs/plans/explore.md): walk a street and a café, or ride as a passenger,
 * with a minimap, a full map and a waypoint. Internal behind `NUXT_PUBLIC_EXPLORE` (404 without
 * it). The 3D runtime loads on demand; this screen owns its lifecycle and the HUD, and every path
 * leads back to the regular menu.
 */

if (!useRuntimeConfig().public.explore) throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })

const tenantPath = useTenantPath()
const route = useRoute()
const colorMode = useColorMode()
const touch = useMediaQuery('(pointer: coarse)')
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

const page = useTemplateRef<HTMLElement>('page')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const world = shallowRef<ExploreWorld | null>(null)
const state = ref<'loading' | 'ready' | 'unavailable'>('loading')
const prompt = ref<Prompt | null>(null)
const status = ref<Status>({
  place: 'Street',
  indoors: false,
  seated: false,
  waypoint: false,
  ride: { label: null, canCall: false, canCancel: false, canSkip: false, view: null },
})
const mapOpen = ref(false)
const ridePickerOpen = ref(false)
const overlayOpen = computed(() => mapOpen.value || ridePickerOpen.value)
const colors = shallowRef<MapColors | null>(null)
const hint = ref(true)
const benchmarking = route.query.bench === 'walk'
const bench = ref<{ phase: string, report: WalkReport | null, copied: boolean } | null>(null)
let detachInput: (() => void) | undefined
let disposed = false

const dark = computed(() => colorMode.value === 'dark')

function readColors() {
  if (page.value) colors.value = readMapColors(page.value)
}

function goToMenu() {
  navigateTo(tenantPath('/'))
}

function interact() {
  world.value?.actions.press('interact')
}

function jump() {
  world.value?.actions.press('jump')
}

function setWaypoint(on: boolean) {
  world.value?.setWaypoint(on)
  if (on) mapOpen.value = false
}

function returnToStreet() {
  world.value?.returnToStreet()
  mapOpen.value = false
}

function callFromMap() {
  if (world.value?.rideAction({ type: 'call' })) mapOpen.value = false
}

function confirmRide(id: string) {
  if (world.value?.rideAction({ type: 'confirm', id })) ridePickerOpen.value = false
}

async function runBenchmark(target: ExploreWorld) {
  bench.value = { phase: 'Starting', report: null, copied: false }
  const report = await target.benchmark((phase) => {
    if (bench.value) bench.value.phase = phase
  })
  if (bench.value) bench.value = { phase: report ? 'Done' : 'Could not run here', report, copied: false }
}

async function copyReport() {
  if (!bench.value?.report) return
  await navigator.clipboard.writeText(formatWalkReport(bench.value.report))
  bench.value.copied = true
}

onMounted(async () => {
  readColors()
  try {
    const { createExploreWorld } = await import('../runtime/world')
    if (disposed || !canvas.value) return
    const created = await createExploreWorld({
      canvas: canvas.value,
      dark: dark.value,
      reducedMotion: reducedMotion.value,
      district: { name: DEMO_CAFE_NAME, layout: demoCafe(), tables: DEMO_TABLES, seed: DEMO_SEED },
      events: {
        prompt: (next) => {
          prompt.value = next
        },
        status: (next) => {
          status.value = next
        },
        firstFrame: () => {
          state.value = 'ready'
        },
        stats: () => {},
        counter: goToMenu,
        chooseRide: () => {
          ridePickerOpen.value = true
        },
        contextLost: () => {
          state.value = 'unavailable'
        },
      },
    })
    if (disposed) {
      created.dispose()
      return
    }
    world.value = created
    detachInput = attachDesktopInput({
      canvas: canvas.value,
      actions: created.actions,
      active: () => !overlayOpen.value && state.value === 'ready',
      onMap: () => {
        mapOpen.value = true
      },
      onLeave: goToMenu,
    })
    if (benchmarking) void runBenchmark(created)
  }
  catch (error) {
    console.error('Explore could not start', error)
    state.value = 'unavailable'
  }
})

// The first move hides the controls hint on desktop; it goes on its own after a while anyway.
const hideHint = useTimeoutFn(() => {
  hint.value = false
}, 9000)
watch(() => status.value.place, (place, before) => {
  if (before && place !== before) hint.value = false
})

watch(overlayOpen, open => world.value?.setPaused(open), { flush: 'sync' })
watch(dark, (value) => {
  world.value?.setTheme(value)
  nextTick(readColors)
})
watch(reducedMotion, value => world.value?.setReducedMotion(value))

onBeforeUnmount(() => {
  disposed = true
  hideHint.stop()
  detachInput?.()
  world.value?.dispose()
  world.value = null
})
</script>

<template>
  <div
    ref="page"
    class="fixed inset-0 overflow-hidden bg-default select-none"
  >
    <div class="absolute inset-0">
      <canvas
        ref="canvas"
        class="block size-full touch-none"
        role="img"
        :aria-label="`A street with ${DEMO_CAFE_NAME}. Move with W, A, S and D or the arrow keys, look with the mouse, press E to act and M for the map.`"
      />
    </div>

    <ExploreTouchControls
      v-if="world && touch && state === 'ready' && !overlayOpen"
      :actions="world.actions"
      :passenger="status.seated && Boolean(status.ride.label)"
    />

    <!-- The HUD: the frame passes taps through to the world; its controls catch them. -->
    <div class="pointer-events-none absolute inset-0 flex flex-col justify-between pt-[max(env(safe-area-inset-top),0.75rem)] pr-[max(env(safe-area-inset-right),0.75rem)] pb-[max(env(safe-area-inset-bottom),0.75rem)] pl-[max(env(safe-area-inset-left),0.75rem)]">
      <div class="flex items-start justify-between gap-2">
        <UButton
          icon="i-lucide-coffee"
          label="View menu"
          color="neutral"
          variant="soft"
          class="pointer-events-auto"
          @click="goToMenu"
        />
        <div
          v-if="state === 'ready'"
          class="flex min-w-0 flex-col items-center gap-1"
          aria-live="polite"
        >
          <UBadge
            :label="status.ride.label ?? status.place"
            :icon="status.ride.label ? 'i-lucide-car-front' : status.indoors ? 'i-lucide-coffee' : 'i-lucide-map-pin'"
            color="neutral"
            variant="soft"
            class="max-w-full whitespace-normal"
          />
          <UBadge
            v-if="status.waypoint && !status.ride.label"
            :label="`Waypoint: ${DEMO_CAFE_NAME}`"
            icon="i-lucide-navigation"
            color="primary"
            variant="soft"
          />
        </div>
        <UButton
          icon="i-lucide-map"
          color="neutral"
          variant="soft"
          class="pointer-events-auto"
          aria-label="Open the map"
          :disabled="state !== 'ready'"
          @click="mapOpen = true"
        />
      </div>

      <div
        v-if="state === 'loading'"
        class="flex flex-col items-center gap-2 self-center"
        role="status"
        aria-busy="true"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-5 animate-spin"
        />
        <p class="text-sm text-muted">
          Building the street…
        </p>
      </div>
      <div
        v-else-if="state === 'unavailable'"
        class="pointer-events-auto flex max-w-sm flex-col items-center gap-3 self-center rounded-lg bg-default p-4 text-center ring ring-default"
      >
        <UIcon
          name="i-lucide-circle-alert"
          class="size-5 text-error"
        />
        <p class="text-sm">
          Explore can't run on this device or browser. The menu works as usual.
        </p>
        <UButton
          icon="i-lucide-coffee"
          label="View menu"
          @click="goToMenu"
        />
      </div>
      <p
        v-else-if="hint && !touch && !status.ride.label"
        class="self-center rounded-md bg-default/90 px-3 py-2 text-center text-sm text-muted ring ring-default"
      >
        Click the street to look around. <UKbd value="W" /><UKbd value="A" /><UKbd value="S" /><UKbd value="D" /> to move,
        <UKbd value="Shift" /> to sprint, <UKbd value="Space" /> to jump, <UKbd value="E" /> to act, <UKbd value="M" /> for the map.
      </p>

      <div
        v-if="state === 'ready'"
        class="flex items-end justify-between gap-2"
      >
        <ExploreMinimap
          v-if="world && colors && state === 'ready'"
          :world="world"
          :colors="colors"
          class="pointer-events-auto"
          @open="mapOpen = true"
        />
        <span v-else />
        <div class="flex min-w-0 flex-col items-end gap-2">
          <UButton
            v-if="status.ride.view"
            :label="status.ride.view === 'inside' ? 'Outside view' : 'Inside view'"
            icon="i-lucide-camera"
            color="neutral"
            variant="soft"
            class="pointer-events-auto"
            @click="world?.actions.press('camera')"
          >
            <template
              v-if="!touch"
              #trailing
            >
              <UKbd value="V" />
            </template>
          </UButton>
          <UButton
            v-if="status.ride.canSkip"
            label="Skip ride"
            icon="i-lucide-skip-forward"
            color="neutral"
            variant="soft"
            class="pointer-events-auto"
            @click="world?.rideAction({ type: 'skip' })"
          />
          <UButton
            v-if="status.ride.canCancel"
            label="Cancel ride"
            color="neutral"
            variant="soft"
            class="pointer-events-auto"
            @click="world?.rideAction({ type: 'cancel' })"
          />
          <div class="flex flex-wrap justify-end gap-2">
            <UButton
              v-if="touch && state === 'ready' && !status.seated"
              icon="i-lucide-arrow-big-up"
              color="neutral"
              variant="soft"
              class="pointer-events-auto"
              aria-label="Jump"
              @click="jump"
            />
            <UButton
              v-if="prompt"
              :label="prompt.label"
              class="pointer-events-auto"
              @click="interact"
            >
              <template
                v-if="!touch"
                #trailing
              >
                <UKbd value="E" />
              </template>
            </UButton>
          </div>
        </div>
      </div>
    </div>
    <p
      class="sr-only"
      aria-live="polite"
    >
      {{ prompt ? `${prompt.label} is available.${touch ? '' : ' Press E.'}` : '' }}
    </p>

    <div
      v-if="bench"
      class="absolute top-16 left-1/2 w-80 max-w-full -translate-x-1/2 space-y-2 rounded-lg bg-default p-3 text-sm ring ring-default"
      role="status"
    >
      <p class="font-semibold text-highlighted">
        Walk benchmark: {{ bench.phase }}
      </p>
      <pre
        v-if="bench.report"
        class="text-xs whitespace-pre-wrap text-muted"
      >{{ formatWalkReport(bench.report) }}</pre>
      <UButton
        v-if="bench.report"
        :label="bench.copied ? 'Copied' : 'Copy'"
        icon="i-lucide-copy"
        color="neutral"
        variant="outline"
        @click="copyReport"
      />
    </div>

    <ExploreFullMap
      v-if="world && colors"
      v-model:open="mapOpen"
      :world="world"
      :colors="colors"
      :waypoint="status.waypoint"
      :can-call-ride="status.ride.canCall"
      @waypoint="setWaypoint"
      @menu="goToMenu"
      @street="returnToStreet"
      @call-ride="callFromMap"
    />
    <ExploreRidePicker
      v-if="world"
      v-model:open="ridePickerOpen"
      :stops="world.rideStops"
      @confirm="confirmRide"
    />
  </div>
</template>
