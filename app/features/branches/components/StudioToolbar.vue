<script setup lang="ts">
/**
 * Studio's floating toolbar (D277). 2D and 3D show the same groups in the same order:
 * - the view's own tools, from the default slot (2D: Select, Hand and Draw)
 * - 2D and 3D
 * - zoom and fit
 * - undo and redo
 * The toolbar keeps no state. Each button tells the view it sits in, and the view acts.
 */
type StudioView = 'design' | '3d'

const { zoomLevel, fitLabel, canFit = true } = defineProps<{
  /** The zoom as a percentage. Leave it out when the view has no zoom level to show (3D). */
  zoomLevel?: number
  /** The fit button's name: "Fit to screen" in 2D, "Fit building" or "Fit scene" in 3D. */
  fitLabel: string
  /** False where fitting doesn't apply (inside a floor in 3D). */
  canFit?: boolean
  canUndo: boolean
  canRedo: boolean
}>()
const view = defineModel<StudioView>('view', { required: true })
const emit = defineEmits<{
  zoom: [direction: 1 | -1]
  /** A zoom percentage from the zoom menu (2D only). */
  zoomTo: [percent: number]
  zoomToSelection: []
  fit: []
  undo: []
  redo: []
}>()

/** The zoom menu on the percentage (2D), with Figma's keys (D278). */
const zoomMenu = computed(() => [[
  { label: 'Zoom in', kbds: ['meta', '+'], onSelect: () => emit('zoom', 1) },
  { label: 'Zoom out', kbds: ['meta', '-'], onSelect: () => emit('zoom', -1) },
], [
  { label: fitLabel, kbds: ['shift', '1'], onSelect: () => emit('fit') },
  { label: 'Zoom to selection', kbds: ['shift', '2'], onSelect: () => emit('zoomToSelection') },
], [
  { label: 'Zoom to 50%', onSelect: () => emit('zoomTo', 50) },
  { label: 'Zoom to 100%', kbds: ['shift', '0'], onSelect: () => emit('zoomTo', 100) },
  { label: 'Zoom to 200%', onSelect: () => emit('zoomTo', 200) },
]])

const views = [
  { value: 'design', label: '2D' },
  { value: '3d', label: '3D' },
] as const
</script>

<template>
  <div
    role="toolbar"
    aria-label="Canvas tools"
    class="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-lg border border-default bg-default p-1 shadow-sm sm:gap-1"
  >
    <template v-if="$slots.default">
      <div
        role="group"
        aria-label="Tools"
        class="flex items-center gap-0.5"
      >
        <slot />
      </div>
      <USeparator
        orientation="vertical"
        class="h-5"
      />
    </template>
    <div
      role="group"
      aria-label="Layout view"
      class="flex items-center gap-0.5"
    >
      <UButton
        v-for="option in views"
        :key="option.value"
        :label="option.label"
        :color="view === option.value ? 'primary' : 'neutral'"
        :variant="view === option.value ? 'soft' : 'ghost'"
        :aria-pressed="view === option.value"
        @click="view = option.value"
      />
    </div>
    <USeparator
      orientation="vertical"
      class="h-5"
    />
    <div
      role="group"
      aria-label="Zoom"
      class="flex items-center gap-0.5"
    >
      <UTooltip text="Zoom out">
        <UButton
          icon="i-lucide-zoom-out"
          color="neutral"
          variant="ghost"
          aria-label="Zoom out"
          @click="emit('zoom', -1)"
        />
      </UTooltip>
      <UDropdownMenu
        v-if="zoomLevel !== undefined"
        :items="zoomMenu"
        :modal="false"
        :content="{ side: 'top' }"
      >
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          :label="`${zoomLevel}%`"
          aria-label="Zoom options"
          class="min-w-12 justify-center text-xs text-muted tabular-nums max-sm:hidden"
          data-testid="zoom-level"
        />
      </UDropdownMenu>
      <UTooltip text="Zoom in">
        <UButton
          icon="i-lucide-zoom-in"
          color="neutral"
          variant="ghost"
          aria-label="Zoom in"
          @click="emit('zoom', 1)"
        />
      </UTooltip>
      <UTooltip :text="fitLabel">
        <UButton
          icon="i-lucide-scan"
          color="neutral"
          variant="ghost"
          :aria-label="fitLabel"
          :disabled="!canFit"
          @click="emit('fit')"
        />
      </UTooltip>
    </div>
    <USeparator
      orientation="vertical"
      class="h-5"
    />
    <div
      role="group"
      aria-label="History"
      class="flex items-center gap-0.5"
    >
      <UTooltip text="Undo">
        <UButton
          icon="i-lucide-undo-2"
          color="neutral"
          variant="ghost"
          aria-label="Undo"
          :disabled="!canUndo"
          @click="emit('undo')"
        />
      </UTooltip>
      <UTooltip text="Redo">
        <UButton
          icon="i-lucide-redo-2"
          color="neutral"
          variant="ghost"
          aria-label="Redo"
          :disabled="!canRedo"
          @click="emit('redo')"
        />
      </UTooltip>
    </div>
  </div>
</template>
