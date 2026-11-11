<script setup lang="ts">
import { until, useMediaQuery, useTimeoutFn } from '@vueuse/core'
import type { PublicExploreLayout } from '#shared/contracts/shop-layout'
import { useBranchOrderCount, useMenuHandoff } from '~/features/menu'
import type { ExploreBranch } from '../composables/useExploreBranches'
import { useExploreBranches } from '../composables/useExploreBranches'
import { useExploreLocation } from '../composables/useExploreLocation'
import { DEMO_CAFE_NAME, DEMO_PLACE, DEMO_SEED, DEMO_TABLES, demoCafe } from '../demo/demo-cafe'
import type { WalkReport } from '../runtime/bench'
import { formatWalkReport } from '../runtime/bench'
import { attachDesktopInput } from '../runtime/desktop-input'
import type { DistrictInput } from '../runtime/district'
import type { MapColors } from '../runtime/map-draw'
import { readMapColors } from '../runtime/map-draw'
import { branchChain } from '../runtime/network'
import { publicDistrictInput } from '../runtime/public-district'
import type { ExploreNetwork, ExploreWorld, Prompt, RideStopOption, Status } from '../runtime/world'
import ExploreFullMap from './ExploreFullMap.vue'
import ExploreMinimap from './ExploreMinimap.vue'
import ExploreRidePicker from './ExploreRidePicker.vue'
import ExploreTouchControls from './ExploreTouchControls.vue'

/**
 * Explore (D275, docs/plans/explore.md): walk a street and a café, or ride as a passenger, with a
 * minimap, a full map and a waypoint. Internal behind `NUXT_PUBLIC_EXPLORE` (404 without it). The
 * 3D runtime loads on demand; this screen owns its lifecycle and the HUD, and every path leads
 * back to the regular menu.
 *
 * Step E4: the cafe's branches in Explore are the districts, joined by gateways, starting at
 * `?at=<branch>` (Back to café, with `&spot=counter`), else the branch chosen on the menu, else the
 * first by name. With none published (or `?bench=walk`, whose numbers must stay comparable) it
 * plays the demo street, and says so.
 */

if (!useRuntimeConfig().public.explore) throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })

const tenantPath = useTenantPath()
const route = useRoute()
const colorMode = useColorMode()
const touch = useMediaQuery('(pointer: coarse)')
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const explore = useExploreBranches()
const location = useExploreLocation()
const { openMenu, chosenBranchId } = useMenuHandoff()

const page = useTemplateRef<HTMLElement>('page')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const world = shallowRef<ExploreWorld | null>(null)
const state = ref<'loading' | 'ready' | 'unavailable'>('loading')
const prompt = ref<Prompt | null>(null)
const status = ref<Status>({
  placeId: '',
  district: DEMO_CAFE_NAME,
  place: 'Street',
  indoors: false,
  seated: false,
  waypoint: null,
  waypointId: null,
  crossing: null,
  ride: { label: null, canCall: false, canCancel: false, canSkip: false, canRetry: false, view: null },
})
/** The branches this world joins (empty on the demo street). */
const network = shallowRef<ExploreBranch[]>([])
const chain = computed(() => branchChain(network.value))
/** Why the demo street is playing, when the cafe has branches but they can't be shown. */
const notice = ref<string | null>(null)
const mapOpen = ref(false)
const ridePickerOpen = ref(false)
const rideStops = shallowRef<RideStopOption[]>([])
const overlayOpen = computed(() => mapOpen.value || ridePickerOpen.value)
const colors = shallowRef<MapColors | null>(null)
const hint = ref(true)
const benchmarking = route.query.bench === 'walk'
const bench = ref<{ phase: string, report: WalkReport | null, copied: boolean } | null>(null)
let detachInput: (() => void) | undefined
let disposed = false

const dark = computed(() => colorMode.value === 'dark')
const isBranch = computed(() => network.value.some(branch => branch.id === status.value.placeId))
const orderCount = useBranchOrderCount(() => (isBranch.value ? status.value.placeId : undefined))

function readColors() {
  if (page.value) colors.value = readMapColors(page.value)
}

/** A branch's menu with that branch chosen; the demo street's goes to the plain menu. */
function goToMenu(placeId = status.value.placeId) {
  if (network.value.some(branch => branch.id === placeId)) return openMenu(placeId)
  return navigateTo(tenantPath('/'))
}

function interact() {
  world.value?.actions.press('interact')
}

function jump() {
  world.value?.actions.press('jump')
}

function setWaypoint(id: string | null) {
  world.value?.setWaypoint(id)
  if (id) mapOpen.value = false
}

function returnToStreet() {
  world.value?.returnToStreet()
  mapOpen.value = false
}

function callFromMap() {
  if (world.value?.rideAction({ type: 'call' })) mapOpen.value = false
}

function rideHere(stopId: string) {
  if (world.value?.rideAction({ type: 'call', stopId })) mapOpen.value = false
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

/** A published branch's district, from its public drawing (step E3). */
async function loadBranch(branch: ExploreBranch): Promise<DistrictInput> {
  const published = await apiFetch<PublicExploreLayout>(`/public/explore/branches/${encodeURIComponent(branch.id)}`)
  return publicDistrictInput(branch, published)
}

/** Where to start: the branch asked for, else the one chosen on the menu, else the first by name. */
function startBranch(branches: readonly ExploreBranch[]): ExploreBranch | undefined {
  const asked = typeof route.query.at === 'string' ? route.query.at : undefined
  const byName = [...branches].sort((left, right) => left.name.localeCompare(right.name))
  return branches.find(branch => branch.id === asked) ?? branches.find(branch => branch.id === chosenBranchId.value) ?? byName[0]
}

const demo: DistrictInput = { name: DEMO_CAFE_NAME, layout: demoCafe(), tables: DEMO_TABLES, seed: DEMO_SEED }

/** The first district: a real branch when one is in Explore and loads, else the demo street. */
async function firstDistrict(): Promise<{ input: DistrictInput, placeId: string, network?: ExploreNetwork }> {
  if (benchmarking) return { input: demo, placeId: DEMO_PLACE }
  await until(() => explore.pending.value).toBe(false)
  const branches = explore.branches.value
  if (explore.error.value) notice.value = 'The cafe\'s branches couldn\'t be loaded, so this is a demo street.'
  const first = startBranch(branches)
  if (!first) {
    notice.value ??= 'No branch is in Explore yet, so this is a demo street.'
    return { input: demo, placeId: DEMO_PLACE }
  }
  try {
    const input = await loadBranch(first)
    network.value = branches
    const load = (id: string) => {
      const branch = branches.find(entry => entry.id === id)
      return branch ? loadBranch(branch) : Promise.reject(new Error('Not in Explore'))
    }
    return { input, placeId: first.id, network: { chain: branchChain(branches), load } }
  }
  catch (error) {
    console.warn('Explore could not load the branch', error)
    notice.value = `${first.name}'s café couldn't be loaded right now, so this is a demo street.`
    return { input: demo, placeId: DEMO_PLACE }
  }
}

onMounted(async () => {
  readColors()
  try {
    const [{ createExploreWorld }, first] = await Promise.all([import('../runtime/world'), firstDistrict()])
    if (disposed || !canvas.value) return
    const created = await createExploreWorld({
      canvas: canvas.value,
      dark: dark.value,
      reducedMotion: reducedMotion.value,
      district: first.input,
      placeId: first.placeId,
      start: route.query.spot === 'counter' ? 'counter' : 'street',
      network: first.network,
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
        counter: placeId => goToMenu(placeId),
        chooseRide: () => {
          rideStops.value = world.value?.rideStops() ?? []
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
      onLeave: () => goToMenu(),
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
        :aria-label="`A street with ${status.district}. Move with W, A, S and D or the arrow keys, look with the mouse, press E to act and M for the map.`"
      />
    </div>

    <ExploreTouchControls
      v-if="world && touch && state === 'ready' && !overlayOpen && !status.crossing"
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
          @click="goToMenu()"
        />
        <div
          v-if="state === 'ready'"
          class="flex min-w-0 flex-col items-center gap-1"
          aria-live="polite"
        >
          <UBadge
            :label="status.crossing && !status.crossing.failed ? `Entering ${status.crossing.name}…` : status.ride.label ?? status.place"
            :icon="status.ride.label ? 'i-lucide-car-front' : status.indoors ? 'i-lucide-coffee' : 'i-lucide-map-pin'"
            color="neutral"
            variant="soft"
            class="max-w-full whitespace-normal"
          />
          <UBadge
            v-if="status.waypoint && !status.ride.label"
            :label="`Waypoint: ${status.waypoint}`"
            icon="i-lucide-navigation"
            color="primary"
            variant="soft"
          />
          <UBadge
            v-if="orderCount > 0"
            :label="`${status.district} · ${orderCount} ${orderCount === 1 ? 'item' : 'items'}`"
            icon="i-lucide-shopping-bag"
            color="neutral"
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
          @click="goToMenu()"
        />
      </div>
      <div
        v-else-if="status.crossing?.failed"
        class="pointer-events-auto flex max-w-sm flex-col items-center gap-3 self-center rounded-lg bg-default p-4 text-center ring ring-default"
        role="alert"
      >
        <p class="text-sm">
          {{ status.crossing.name }}'s street couldn't be loaded. Check your connection and try again, or stay on this street.
        </p>
        <div class="flex flex-wrap justify-center gap-2">
          <UButton
            icon="i-lucide-refresh-cw"
            label="Retry"
            @click="world?.retryCrossing()"
          />
          <UButton
            label="Go back"
            color="neutral"
            variant="outline"
            @click="world?.cancelCrossing()"
          />
        </div>
      </div>
      <div
        v-else-if="notice"
        class="pointer-events-auto flex max-w-sm items-start gap-2 self-center rounded-md bg-default/90 px-3 py-2 text-sm text-muted ring ring-default"
        role="status"
      >
        <span>{{ notice }}</span>
        <UButton
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Dismiss"
          @click="notice = null"
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
            v-if="status.ride.canRetry"
            label="Retry"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="soft"
            class="pointer-events-auto"
            @click="world?.rideAction({ type: 'retry' })"
          />
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
      :place-id="status.placeId"
      :waypoint-id="status.waypointId"
      :can-call-ride="status.ride.canCall"
      :branches="network"
      :chain="chain"
      :location="location.state.value"
      :position="location.position.value"
      @waypoint="setWaypoint"
      @menu="goToMenu"
      @street="returnToStreet"
      @call-ride="callFromMap"
      @ride="rideHere"
      @locate="location.locate"
    />
    <ExploreRidePicker
      v-if="world"
      v-model:open="ridePickerOpen"
      :stops="rideStops"
      @confirm="confirmRide"
    />
  </div>
</template>
