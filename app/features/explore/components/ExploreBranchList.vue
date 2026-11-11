<script setup lang="ts">
import { openingText } from '~/features/menu'
import type { ExploreBranch } from '../composables/useExploreBranches'
import type { LocationState } from '../composables/useExploreLocation'
import type { NearbyEntry, Pin } from '../runtime/network'
import { formatKm, nearbyList } from '../runtime/network'
import type { RideStopOption } from '../runtime/world'

/**
 * The branch list beside the full map (D275, docs/plans/explore.md → Full map, step E4): every
 * branch in Explore with whether it's open, its **real** distance once the customer shares their
 * location, and the tuk-tuk's **Explore** time, always labelled apart. Set waypoint, Ride here and
 * View menu act on one branch.
 */

const { branches, currentId, waypointId, location, position, rideStops, canRide } = defineProps<{
  branches: readonly ExploreBranch[]
  currentId: string
  waypointId: string | null
  location: LocationState
  position: Pin | null
  rideStops: readonly RideStopOption[]
  canRide: boolean
}>()
const emit = defineEmits<{ waypoint: [id: string | null], ride: [stopId: string], menu: [id: string], locate: [] }>()

const list = computed(() => nearbyList(branches, position))
const groups = computed(() => {
  if (!position) return [{ title: null as string | null, entries: list.value.near }]
  return [
    { title: 'Within 5 km', entries: list.value.near },
    { title: 'Farther', entries: list.value.farther },
  ].filter(group => group.entries.length)
})

const locationNote = computed(() => {
  switch (location.kind) {
    case 'locating': return 'Finding where you are…'
    case 'denied': return 'Location is off for this site, so branches are listed by name.'
    case 'unavailable': return 'Your location isn\'t available right now, so branches are listed by name.'
    default: return null
  }
})

function opening(branch: ExploreBranch): string {
  if (branch.openNow) return branch.pausedUntil ? 'Open · not taking online orders' : 'Open now'
  return openingText(branch) ?? 'Closed'
}

function stopFor(entry: NearbyEntry<ExploreBranch>) {
  return rideStops.find(stop => stop.branchId === entry.branch.id)
}
</script>

<template>
  <section
    class="space-y-3"
    aria-labelledby="explore-branches-title"
  >
    <div class="flex items-center justify-between gap-2">
      <h3
        id="explore-branches-title"
        class="font-semibold text-highlighted"
      >
        Branches
      </h3>
      <UButton
        v-if="location.kind !== 'found'"
        icon="i-lucide-locate"
        label="Explore nearby"
        size="sm"
        color="neutral"
        variant="outline"
        :loading="location.kind === 'locating'"
        @click="emit('locate')"
      />
    </div>
    <p
      v-if="locationNote"
      class="text-sm text-muted"
      role="status"
    >
      {{ locationNote }}
    </p>
    <p
      v-if="!branches.length"
      class="text-sm text-muted"
    >
      No branch is in Explore yet. The menu works as usual.
    </p>

    <div
      v-for="group in groups"
      :key="group.title ?? 'all'"
      class="space-y-2"
    >
      <h4
        v-if="group.title"
        class="text-xs font-medium text-muted uppercase"
      >
        {{ group.title }}
      </h4>
      <ul class="space-y-2">
        <li
          v-for="entry in group.entries"
          :key="entry.branch.id"
          class="space-y-2 rounded-md p-3 ring ring-default"
        >
          <div class="space-y-0.5">
            <p class="font-medium text-highlighted">
              {{ entry.branch.name }}
              <UBadge
                v-if="entry.branch.id === currentId"
                label="You're here"
                color="primary"
                variant="soft"
                size="sm"
                class="ms-1 align-middle"
              />
            </p>
            <p class="text-sm text-muted">
              {{ opening(entry.branch) }}
            </p>
            <p
              v-if="entry.km !== null || stopFor(entry)"
              class="text-sm text-muted"
            >
              <span v-if="entry.km !== null">{{ formatKm(entry.km) }} from you</span>
              <span v-if="entry.km !== null && stopFor(entry)"> · </span>
              <span v-if="stopFor(entry)">About {{ stopFor(entry)!.seconds }} s by tuk-tuk in Explore</span>
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-if="waypointId !== entry.branch.id"
              icon="i-lucide-map-pin"
              label="Set waypoint"
              size="sm"
              :aria-label="`Set waypoint: ${entry.branch.name}`"
              @click="emit('waypoint', entry.branch.id)"
            />
            <UButton
              v-else
              icon="i-lucide-map-pin-off"
              label="Clear waypoint"
              size="sm"
              color="neutral"
              variant="outline"
              @click="emit('waypoint', null)"
            />
            <UButton
              v-if="stopFor(entry) && canRide"
              icon="i-lucide-car-front"
              label="Ride here"
              size="sm"
              color="neutral"
              variant="outline"
              :aria-label="`Ride here: ${entry.branch.name}`"
              @click="emit('ride', stopFor(entry)!.id)"
            />
            <UButton
              icon="i-lucide-coffee"
              label="View menu"
              size="sm"
              color="neutral"
              variant="outline"
              :aria-label="`View menu: ${entry.branch.name}`"
              @click="emit('menu', entry.branch.id)"
            />
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
