<script setup lang="ts">
/**
 * Start your shop layout (D273, frame 6C): shown while the branch has no layout. A starter only
 * draws outlines, doors and windows; the branch's tables wait in Unplaced tables.
 */
import type { Point } from '#shared/contracts/shop-layout'
import { boundsOf } from '../designer/geometry'
import { STARTERS } from '../designer/starters'
import type { Starter } from '../designer/starters'

defineProps<{ tableCount: number }>()
const emit = defineEmits<{ choose: [starter: Starter] }>()

const chosen = ref<Starter>(STARTERS[1]!)

/** Each floor's outline, fitted into the card's picture; upper floors drawn dashed. */
const previews = Object.fromEntries(STARTERS.map((starter) => {
  const floors = starter.layout().floors.filter(floor => floor.outline.length >= 3)
  const bounds = boundsOf(floors.flatMap(floor => floor.outline))
  const scale = floors.length ? Math.min(100 / (bounds.maxX - bounds.minX), 72 / (bounds.maxY - bounds.minY)) : 1
  const fit = (point: Point) => `${10 + (point.x - bounds.minX) * scale},${10 + (point.y - bounds.minY) * scale}`
  return [starter.id, floors.map((floor, index) => ({ points: floor.outline.map(fit).join(' '), upper: index > 0 }))]
}))
</script>

<template>
  <div class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
    <div>
      <h2 class="text-base font-semibold text-highlighted">
        Start your shop layout
      </h2>
      <p class="text-sm text-muted">
        Pick a starting shape. You can change every wall later. Your {{ tableCount }} {{ tableCount === 1 ? 'table waits' : 'tables wait' }} in Unplaced tables.
      </p>
    </div>
    <div
      class="grid grid-cols-2 gap-3 md:grid-cols-4"
      role="radiogroup"
      aria-label="Starting shape"
    >
      <button
        v-for="starter in STARTERS"
        :key="starter.id"
        type="button"
        role="radio"
        :aria-checked="chosen.id === starter.id"
        class="flex flex-col gap-2 rounded-lg border border-default bg-default p-2 text-left text-sm font-medium text-highlighted hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary aria-checked:border-primary aria-checked:ring-2 aria-checked:ring-primary/30"
        :data-testid="`starter-${starter.id}`"
        @click="chosen = starter"
        @dblclick="emit('choose', starter)"
      >
        <svg
          viewBox="0 0 120 92"
          class="h-24 w-full rounded-md bg-muted"
          aria-hidden="true"
        >
          <path
            v-if="!previews[starter.id]?.length"
            d="M56 46h8M60 42v8"
            stroke="var(--ui-text-dimmed)"
            stroke-width="2"
          />
          <polygon
            v-for="(floor, index) in previews[starter.id]"
            :key="index"
            :points="floor.points"
            :fill="floor.upper ? 'none' : 'var(--ui-bg)'"
            stroke="var(--ui-text-toned)"
            :stroke-width="floor.upper ? 1.5 : 2.5"
            :stroke-dasharray="floor.upper ? '3 3' : undefined"
            :transform="floor.upper ? `translate(${index * 4} ${-index * 4})` : undefined"
          />
        </svg>
        <span>
          {{ starter.name }}
          <span class="block text-xs font-normal text-muted">{{ starter.description }}</span>
        </span>
      </button>
    </div>
    <div class="flex justify-end">
      <UButton
        :label="`Use ${chosen.name}`"
        data-testid="use-starter"
        @click="emit('choose', chosen)"
      />
    </div>
  </div>
</template>
