<script setup lang="ts">
/**
 * An outline edge, selected (D273, frame 3B): what it is (Wall, Railing or Open), its length, and
 * the doors and windows on it. A door on a railing is a gate; windows need a wall. Each change is
 * one undo step, emitted as the floor's new shape.
 */
import type { EdgeKind, OpeningKind } from '#shared/contracts/shop-layout'
import { edgeLength } from '#shared/contracts/shop-layout'
import { newLayoutId } from '../designer/geometry'
import { addOpening, edgeTakes, freeSpot, OPENING_DEFAULT_WIDTH, OPENING_MIN_WIDTH, removeOpening, setEdgeKind, setEdgeLength, updateOpening } from '../designer/outline'
import type { FloorShape } from '../designer/outline'

const props = defineProps<{
  shape: FloorShape
  index: number
  name: string
}>()
const emit = defineEmits<{ change: [shape: FloorShape], close: [] }>()

const edge = computed(() => props.shape.edges[props.index]!)
const length = computed(() => Math.round(edgeLength(props.shape.outline, props.index)))
const KINDS: { value: EdgeKind, label: string }[] = [
  { value: 'wall', label: 'Wall' },
  { value: 'railing', label: 'Railing' },
  { value: 'open', label: 'Open' },
]
const HELP: Record<EdgeKind, string> = {
  wall: 'Solid in 3D.',
  railing: 'Waist-high posts and a rail.',
  open: 'Nothing: open towards a terrace on the same level.',
}
const doorLabel = computed(() => (edge.value.kind === 'railing' ? 'Gate' : 'Door'))
const openingName = (kind: OpeningKind) => (kind === 'window' ? 'Window' : doorLabel.value)
const fits = (kind: OpeningKind) => edgeTakes(edge.value.kind, kind) && freeSpot(edge.value, length.value, Math.min(OPENING_DEFAULT_WIDTH[kind], length.value)) !== null && length.value >= OPENING_MIN_WIDTH

function setNumber(value: number | null | undefined, apply: (value: number) => FloorShape) {
  if (typeof value === 'number' && Number.isFinite(value)) emit('change', apply(Math.round(value)))
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-3">
      <span class="flex size-9 items-center justify-center rounded-md bg-elevated text-muted">
        <UIcon
          name="i-lucide-square-dashed"
          class="size-5"
        />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-base font-semibold text-highlighted">
          {{ name }}
        </p>
        <p class="text-xs text-muted tabular-nums">
          {{ length }} cm
        </p>
      </div>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        aria-label="Close panel"
        @click="emit('close')"
      />
    </div>

    <UFormField
      label="Edge type"
      :help="HELP[edge.kind]"
    >
      <UFieldGroup
        class="w-full"
        role="group"
        aria-label="Edge type"
      >
        <UButton
          v-for="kind in KINDS"
          :key="kind.value"
          :label="kind.label"
          :color="edge.kind === kind.value ? 'primary' : 'neutral'"
          :variant="edge.kind === kind.value ? 'soft' : 'outline'"
          :aria-pressed="edge.kind === kind.value"
          class="flex-1 justify-center"
          @click="emit('change', setEdgeKind(shape, index, kind.value))"
        />
      </UFieldGroup>
    </UFormField>

    <UFormField
      label="Length (cm)"
      help="Moves the edge's end corner; the corners next to it keep their right angles."
    >
      <UInputNumber
        :model-value="length"
        :min="10"
        :max="10000"
        :step="5"
        @update:model-value="value => setNumber(value, next => setEdgeLength(shape, index, next))"
      />
    </UFormField>

    <div
      v-if="edge.kind !== 'open'"
      class="flex flex-col gap-2"
    >
      <p class="text-sm font-medium text-highlighted">
        Add on this edge
      </p>
      <div class="grid grid-cols-2 gap-2">
        <UButton
          :label="doorLabel"
          icon="i-lucide-door-open"
          color="neutral"
          variant="outline"
          :disabled="!fits('door')"
          @click="emit('change', addOpening(shape, index, 'door', newLayoutId('door')))"
        />
        <UButton
          label="Window"
          icon="i-lucide-app-window"
          color="neutral"
          variant="outline"
          :disabled="!fits('window')"
          @click="emit('change', addOpening(shape, index, 'window', newLayoutId('window')))"
        />
      </div>
      <p
        v-if="edge.kind === 'railing'"
        class="text-xs text-muted"
      >
        Windows need a wall. On a railing, a door is called a gate.
      </p>
    </div>

    <div
      v-for="opening in edge.openings"
      :key="opening.id"
      class="flex flex-col gap-2 rounded-md border border-default p-3"
      :data-testid="`opening-${opening.kind}`"
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
          @click="emit('change', removeOpening(shape, index, opening.id))"
        />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <UFormField label="Width (cm)">
          <UInputNumber
            :model-value="opening.width"
            :min="OPENING_MIN_WIDTH"
            :max="length"
            :step="5"
            @update:model-value="value => setNumber(value, width => updateOpening(shape, index, opening.id, { width }))"
          />
        </UFormField>
        <UFormField label="From the corner (cm)">
          <UInputNumber
            :model-value="opening.offset"
            :min="0"
            :max="Math.max(0, length - opening.width)"
            :step="5"
            @update:model-value="value => setNumber(value, offset => updateOpening(shape, index, opening.id, { offset }))"
          />
        </UFormField>
      </div>
    </div>
  </div>
</template>
