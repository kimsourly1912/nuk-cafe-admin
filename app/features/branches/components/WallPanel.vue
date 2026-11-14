<script setup lang="ts">
import StudioNumberField from './StudioNumberField.vue'
/**
 * A wall, selected (D278, D282: outer and inside walls alike): what it is (Wall, Railing, Half
 * wall or Glass), its length, how it is built (thickness, height, which side of its line it stands:
 * owner D3), and its doors and windows. Each change is one undo step, emitted as the floor's new
 * list of walls.
 */
import type { OpeningKind, Wall, WallKind, WallSide } from '#shared/contracts/shop-layout'
import { WALL_HEIGHT_MIN_CM, WALL_THICKNESS_MAX_CM, WALL_THICKNESS_MIN_CM, wallKind, wallLength } from '#shared/contracts/shop-layout'
import { newLayoutId, wallHeight, wallThickness } from '../designer/geometry'
import { addWallOpening, OPENING_MIN_WIDTH, removeWallOpening, setWallKind, setWallLength, setWallStructure, updateWallOpening, wallOpeningFits } from '../designer/walls'

const props = defineProps<{
  walls: readonly Wall[]
  wall: Wall
  /** The floor's height: a wall stands at most this tall. */
  floorHeight: number
}>()
const emit = defineEmits<{ change: [walls: Wall[]], remove: [], close: [] }>()

const kind = computed(() => wallKind(props.wall))
const length = computed(() => Math.round(wallLength(props.wall)))
const KINDS: { value: WallKind, label: string, help: string }[] = [
  { value: 'wall', label: 'Wall', help: 'Floor to ceiling. Takes doors and windows.' },
  { value: 'railing', label: 'Railing', help: 'Waist-high posts and a rail: a mezzanine\'s edge.' },
  { value: 'half', label: 'Half wall', help: '110 cm high: a bar\'s back or a low divider.' },
  { value: 'glass', label: 'Glass', help: 'A glass partition, floor to ceiling.' },
]
const kindLabel = computed(() => KINDS.find(option => option.value === kind.value)!.label)
const thickness = computed(() => wallThickness(props.wall))
const height = computed(() => wallHeight(props.wall, props.floorHeight))
/** Where it stands on its line: an outer wall stands beside it, outside its floor (D282). */
const SIDES: { value: WallSide | 'centre', label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'centre', label: 'Centre' },
  { value: 'right', label: 'Right' },
]
const side = computed(() => props.wall.side ?? 'centre')
/** A door in a railing is a gate; in a half wall or glass it is a gap to walk through. */
const doorLabel = computed(() => (kind.value === 'railing' ? 'Gate' : kind.value === 'wall' ? 'Door' : 'Opening'))
const openingName = (opening: OpeningKind) => (opening === 'window' ? 'Window' : doorLabel.value)

function setNumber(value: number | null | undefined, current: number, apply: (value: number) => Wall[]) {
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
          {{ kindLabel }}
        </p>
        <p class="text-xs text-muted tabular-nums">
          {{ length }} cm · {{ thickness }} cm thick
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
          @click="emit('change', setWallKind(walls, wall.id, option.value))"
        />
      </div>
    </UFormField>

    <UFormField
      label="Length (cm)"
      help="Moves the wall's end along it. Drag an end on the plan to turn it."
    >
      <StudioNumberField
        :model-value="length"
        label="Length"
        unit="cm"
        :min="10"
        :max="10000"
        @update:model-value="value => setNumber(value, length, next => setWallLength(walls, wall.id, next))"
      />
    </UFormField>

    <div class="grid grid-cols-2 gap-3">
      <UFormField label="Thickness (cm)">
        <StudioNumberField
          :model-value="thickness"
          label="Thickness"
          unit="cm"
          :min="WALL_THICKNESS_MIN_CM"
          :max="WALL_THICKNESS_MAX_CM"
          @update:model-value="value => setNumber(value, thickness, next => setWallStructure(walls, wall.id, { thickness: next }))"
        />
      </UFormField>
      <UFormField label="Height (cm)">
        <StudioNumberField
          :model-value="height"
          label="Height"
          unit="cm"
          :min="WALL_HEIGHT_MIN_CM"
          :max="floorHeight"
          @update:model-value="value => setNumber(value, height, next => setWallStructure(walls, wall.id, { height: next }))"
        />
      </UFormField>
    </div>
    <UButton
      v-if="wall.thickness || wall.height"
      label="Use the type's thickness and height"
      icon="i-lucide-rotate-ccw"
      color="neutral"
      variant="link"
      size="xs"
      class="self-start px-0"
      @click="emit('change', setWallStructure(walls, wall.id, { thickness: null, height: null }))"
    />

    <UFormField
      label="Stands on its line"
      help="An outer wall stands beside its line, outside the floor, so the room keeps the size drawn."
    >
      <div
        class="grid grid-cols-3 gap-1"
        role="group"
        aria-label="Stands on its line"
      >
        <UButton
          v-for="option in SIDES"
          :key="option.value"
          :label="option.label"
          :color="side === option.value ? 'primary' : 'neutral'"
          :variant="side === option.value ? 'soft' : 'outline'"
          :aria-pressed="side === option.value"
          class="justify-center"
          @click="emit('change', setWallStructure(walls, wall.id, { side: option.value === 'centre' ? null : option.value }))"
        />
      </div>
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
          :disabled="!wallOpeningFits(wall, 'door')"
          @click="emit('change', addWallOpening(walls, wall.id, 'door', newLayoutId('door')))"
        />
        <UButton
          v-if="kind === 'wall'"
          label="Window"
          icon="i-lucide-app-window"
          color="neutral"
          variant="outline"
          :disabled="!wallOpeningFits(wall, 'window')"
          @click="emit('change', addWallOpening(walls, wall.id, 'window', newLayoutId('window')))"
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
          @click="emit('change', removeWallOpening(walls, wall.id, opening.id))"
        />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <UFormField label="Width (cm)">
          <StudioNumberField
            :model-value="opening.width"
            label="Width"
            unit="cm"
            :min="OPENING_MIN_WIDTH"
            :max="length"
            @update:model-value="value => setNumber(value, opening.width, width => updateWallOpening(walls, wall.id, opening.id, { width }))"
          />
        </UFormField>
        <UFormField label="From the start (cm)">
          <StudioNumberField
            :model-value="opening.offset"
            label="From the start"
            unit="cm"
            :min="0"
            :max="Math.max(0, length - opening.width)"
            @update:model-value="value => setNumber(value, opening.offset, offset => updateWallOpening(walls, wall.id, opening.id, { offset }))"
          />
        </UFormField>
      </div>
    </div>
  </div>
</template>
