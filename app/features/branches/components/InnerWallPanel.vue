<script setup lang="ts">
/**
 * An inside wall, selected (D278): what it is (Wall, Railing, Half wall or Glass), its length, and
 * its doors and windows, like an outline edge's panel. Each change is one undo step, emitted as
 * the floor's new list of inside walls.
 */
import type { InnerWall, InnerWallKind, OpeningKind } from '#shared/contracts/shop-layout'
import { innerWallKind, innerWallLength } from '#shared/contracts/shop-layout'
import { newLayoutId } from '../designer/geometry'
import { OPENING_MIN_WIDTH } from '../designer/outline'
import { addInnerOpening, innerOpeningFits, removeInnerOpening, setInnerWallKind, setInnerWallLength, updateInnerOpening } from '../designer/walls'

const props = defineProps<{
  walls: readonly InnerWall[]
  wall: InnerWall
}>()
const emit = defineEmits<{ change: [walls: InnerWall[]], remove: [], close: [] }>()

const kind = computed(() => innerWallKind(props.wall))
const length = computed(() => Math.round(innerWallLength(props.wall)))
const KINDS: { value: InnerWallKind, label: string, help: string }[] = [
  { value: 'wall', label: 'Wall', help: 'Floor to ceiling. Takes doors and windows.' },
  { value: 'railing', label: 'Railing', help: 'Waist-high posts and a rail: a mezzanine\'s edge.' },
  { value: 'half', label: 'Half wall', help: '110 cm high: a bar\'s back or a low divider.' },
  { value: 'glass', label: 'Glass', help: 'A glass partition, floor to ceiling.' },
]
const kindLabel = computed(() => KINDS.find(option => option.value === kind.value)!.label)
/** A door in a railing is a gate; in a half wall or glass it is a gap to walk through. */
const doorLabel = computed(() => (kind.value === 'railing' ? 'Gate' : kind.value === 'wall' ? 'Door' : 'Opening'))
const openingName = (opening: OpeningKind) => (opening === 'window' ? 'Window' : doorLabel.value)

function setNumber(value: number | null | undefined, current: number, apply: (value: number) => InnerWall[]) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.round(value) === current) return
  emit('change', apply(Math.round(value)))
}
</script>

<template>
  <div
    class="flex flex-col gap-4"
    data-testid="selected-wall"
  >
    <div class="flex items-center gap-3">
      <span class="flex size-9 items-center justify-center rounded-md bg-elevated text-muted">
        <UIcon
          name="i-lucide-brick-wall"
          class="size-5"
        />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-base font-semibold text-highlighted">
          Inside {{ kindLabel.toLowerCase() }}
        </p>
        <p class="text-xs text-muted tabular-nums">
          {{ length }} cm
        </p>
      </div>
      <UTooltip
        text="Delete wall"
        :kbds="['delete']"
      >
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          aria-label="Delete wall"
          @click="emit('remove')"
        />
      </UTooltip>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        aria-label="Close panel"
        @click="emit('close')"
      />
    </div>

    <UFormField
      label="Wall type"
      :help="KINDS.find(option => option.value === kind)!.help"
    >
      <div
        class="grid grid-cols-2 gap-1"
        role="group"
        aria-label="Wall type"
      >
        <UButton
          v-for="option in KINDS"
          :key="option.value"
          :label="option.label"
          :color="kind === option.value ? 'primary' : 'neutral'"
          :variant="kind === option.value ? 'soft' : 'outline'"
          :aria-pressed="kind === option.value"
          class="justify-center"
          @click="emit('change', setInnerWallKind(walls, wall.id, option.value))"
        />
      </div>
    </UFormField>

    <UFormField
      label="Length (cm)"
      help="Moves the wall's end along it. Drag an end on the plan to turn it."
    >
      <UInputNumber
        :model-value="length"
        :min="10"
        :max="10000"
        :step="5"
        @update:model-value="value => setNumber(value, length, next => setInnerWallLength(walls, wall.id, next))"
      />
    </UFormField>

    <div class="flex flex-col gap-2">
      <p class="text-sm font-medium text-highlighted">
        Add on this wall
      </p>
      <div class="grid grid-cols-2 gap-2">
        <UButton
          :label="doorLabel"
          icon="i-lucide-door-open"
          color="neutral"
          variant="outline"
          :disabled="!innerOpeningFits(wall, 'door')"
          @click="emit('change', addInnerOpening(walls, wall.id, 'door', newLayoutId('door')))"
        />
        <UButton
          v-if="kind === 'wall'"
          label="Window"
          icon="i-lucide-app-window"
          color="neutral"
          variant="outline"
          :disabled="!innerOpeningFits(wall, 'window')"
          @click="emit('change', addInnerOpening(walls, wall.id, 'window', newLayoutId('window')))"
        />
      </div>
    </div>

    <div
      v-for="opening in wall.openings ?? []"
      :key="opening.id"
      class="flex flex-col gap-2 rounded-md border border-default p-3"
      :data-testid="`wall-opening-${opening.kind}`"
    >
      <div class="flex items-center justify-between">
        <p class="text-sm font-medium text-highlighted">
          {{ openingName(opening.kind) }}
        </p>
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="`Remove this ${openingName(opening.kind).toLowerCase()}`"
          @click="emit('change', removeInnerOpening(walls, wall.id, opening.id))"
        />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <UFormField label="Width (cm)">
          <UInputNumber
            :model-value="opening.width"
            :min="OPENING_MIN_WIDTH"
            :max="length"
            :step="5"
            @update:model-value="value => setNumber(value, opening.width, width => updateInnerOpening(walls, wall.id, opening.id, { width }))"
          />
        </UFormField>
        <UFormField label="From the start (cm)">
          <UInputNumber
            :model-value="opening.offset"
            :min="0"
            :max="Math.max(0, length - opening.width)"
            :step="5"
            @update:model-value="value => setNumber(value, opening.offset, offset => updateInnerOpening(walls, wall.id, opening.id, { offset }))"
          />
        </UFormField>
      </div>
    </div>
  </div>
</template>
