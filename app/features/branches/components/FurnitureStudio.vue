<script setup lang="ts">
/**
 * Furniture studio (the owner's references, 2026-11-10): start from a preset, change its size, base
 * and finishes part by part, and see the same generated model the building uses, on a turntable or
 * from above as the plan draws it. Step 1 previews only: saving a custom look is step 3a (D273), a
 * reference photo step 3b.
 */
import type { Finish, ItemKind, LookChair, TableBase, TableLook } from '#shared/contracts/shop-layout'
import type { FinishSlot } from '../designer/catalog'
import { BUILT_IN_LOOKS, FINISH_SWATCHES, ITEM_SPECS, itemFinish, lookFinish, TABLE_SLOTS } from '../designer/catalog'
import type { StudioViewer } from '../designer/scene/studio-viewer'

type Category = 'tables' | 'chairs' | 'fixtures'
type Preset
  = | { id: string, category: 'tables', name: string, look: TableLook }
    | { id: string, category: 'chairs' | 'fixtures', name: string, kind: ItemKind }

const PRESETS: Preset[] = [
  ...BUILT_IN_LOOKS.map(look => ({ id: look.id, category: 'tables' as const, name: look.name, look })),
  ...(['cafe-chair', 'bentwood-chair', 'bar-stool', 'dining-bench'] as const).map(kind => ({ id: kind, category: 'chairs' as const, name: ITEM_SPECS[kind].label, kind })),
  ...(['service-counter', 'display-shelf', 'planter', 'room-divider', 'plant'] as const).map(kind => ({ id: kind, category: 'fixtures' as const, name: ITEM_SPECS[kind].label, kind })),
]
const CATEGORY_TABS = [
  { label: 'Tables', value: 'tables' as const },
  { label: 'Chairs', value: 'chairs' as const },
  { label: 'Fixtures', value: 'fixtures' as const },
]
const ICONS: Record<string, string> = { tables: 'i-lucide-table-2', chairs: 'i-lucide-armchair', fixtures: 'i-lucide-store' }
const CHAIR_ITEMS: { label: string, value: LookChair }[] = [
  { label: 'Café chair', value: 'cafe-chair' },
  { label: 'Bentwood chair', value: 'bentwood-chair' },
  { label: 'Bar stool', value: 'bar-stool' },
  { label: 'No chairs (booth or bench)', value: 'none' },
]

const category = ref<Category>('tables')
const presetId = ref(PRESETS[0]!.id)
const preset = computed(() => PRESETS.find(candidate => candidate.id === presetId.value)!)
const name = ref('')
const width = ref(80)
const depth = ref(80)
const base = ref<TableBase>('pedestal')
const chair = ref<LookChair>('cafe-chair')
const finishes = ref<Partial<Record<string, Finish>>>({})
const withChairs = ref(false)
const view = ref<'3d' | 'top'>('3d')

const round = computed(() => preset.value.category === 'tables' ? preset.value.look.shape === 'round' : ITEM_SPECS[preset.value.kind].footprint === 'round')
const height = computed(() => preset.value.category === 'tables' ? 74 : ITEM_SPECS[preset.value.kind].height)
const visiblePresets = computed(() => PRESETS.filter(candidate => candidate.category === category.value))

/** The look being previewed: the preset with this panel's changes. */
const look = computed<TableLook | null>(() => preset.value.category === 'tables'
  ? { ...preset.value.look, base: base.value, chair: chair.value, finishes: { ...preset.value.look.finishes, ...finishes.value } }
  : null)

const slots = computed<FinishSlot[]>(() => {
  if (preset.value.category !== 'tables') return ITEM_SPECS[preset.value.kind].slots
  const tableSlots = [TABLE_SLOTS.top, TABLE_SLOTS.base]
  if (chair.value === 'none' && preset.value.look.shape !== 'booth') return tableSlots
  const seating = chair.value === 'none' ? ITEM_SPECS['dining-bench'] : ITEM_SPECS[chair.value]
  return [...tableSlots, ...seating.slots.map(slot => ({ ...slot, label: `Seating: ${slot.label.toLowerCase()}` }))]
})

function finishOf(slot: FinishSlot): Finish {
  if (look.value) return lookFinish(look.value, slot.key)
  return preset.value.category === 'tables' ? slot.default : itemFinish(preset.value.kind, finishes.value, slot.key)
}

function choose(id: string) {
  presetId.value = id
  const next = preset.value
  name.value = next.name
  finishes.value = {}
  if (next.category === 'tables') {
    width.value = next.look.defaultWidth
    depth.value = next.look.defaultDepth
    base.value = next.look.base
    chair.value = next.look.chair
  }
  else {
    width.value = ITEM_SPECS[next.kind].width
    depth.value = ITEM_SPECS[next.kind].depth
  }
}
choose(presetId.value)

watch(category, (next) => {
  if (preset.value.category !== next) choose(PRESETS.find(candidate => candidate.category === next)!.id)
})

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const colorMode = useColorMode()
const status = ref<'loading' | 'ready' | 'unavailable'>('loading')
let viewer: StudioViewer | null = null
let builders: typeof import('../designer/scene/furniture') | null = null

function render() {
  if (!viewer || !builders) return
  const { buildItem, buildTable } = builders
  const current = preset.value
  const currentLook = look.value
  viewer.show(context => current.category === 'tables' && currentLook
    ? buildTable(context, withChairs.value ? currentLook : { ...currentLook, chair: 'none' }, width.value, round.value ? width.value : depth.value, withChairs.value ? 4 : 0)
    : buildItem(context, { kind: (current as { kind: ItemKind }).kind, width: width.value, depth: round.value ? width.value : depth.value, finishes: finishes.value }))
}

onMounted(async () => {
  try {
    const [{ createStudioViewer }, furniture] = await Promise.all([import('../designer/scene/studio-viewer'), import('../designer/scene/furniture')])
    if (!canvas.value) return
    builders = furniture
    viewer = createStudioViewer({ canvas: canvas.value, dark: colorMode.value === 'dark', onContextLost: () => (status.value = 'unavailable') })
    render()
    status.value = 'ready'
  }
  catch {
    status.value = 'unavailable'
  }
})
onBeforeUnmount(() => viewer?.dispose())
watch([presetId, width, depth, base, chair, finishes, withChairs], render, { deep: true })
watch(() => colorMode.value, value => viewer?.setTheme(value === 'dark'))
watch(view, value => viewer?.setView(value))

const resetView = () => viewer?.reset()

function setSize(value: number | null | undefined, apply: (size: number) => void) {
  if (typeof value === 'number' && Number.isFinite(value)) apply(Math.round(value))
}
</script>

<template>
  <div class="flex h-full min-h-0">
    <aside
      aria-label="Presets"
      class="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-default p-4 lg:flex"
    >
      <h2 class="text-base font-semibold text-highlighted">
        Start from a preset
      </h2>
      <UTabs
        v-model="category"
        :items="CATEGORY_TABS"
        :content="false"
        size="sm"
      />
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="candidate in visiblePresets"
          :key="candidate.id"
          type="button"
          class="flex min-h-24 flex-col items-start justify-between gap-2 rounded-lg border p-3 text-left text-sm text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
          :class="candidate.id === presetId ? 'border-primary bg-primary/10' : 'border-default hover:bg-elevated'"
          :aria-pressed="candidate.id === presetId"
          @click="choose(candidate.id)"
        >
          <UIcon
            :name="ICONS[candidate.category]"
            class="size-6 text-muted"
          />
          {{ candidate.name }}
        </button>
      </div>
    </aside>

    <main
      aria-label="Preview"
      class="relative flex min-w-0 flex-1 flex-col bg-muted"
    >
      <div class="flex items-start justify-between gap-3 p-4">
        <div>
          <h2 class="text-xl font-semibold text-highlighted">
            {{ name || preset.name }}
          </h2>
          <p class="text-sm text-muted">
            {{ preset.category === 'tables' ? 'Table preset' : preset.category === 'chairs' ? 'Chair preset' : 'Fixture preset' }}
          </p>
        </div>
        <UFieldGroup class="rounded-md bg-default">
          <UButton
            label="3D"
            :color="view === '3d' ? 'primary' : 'neutral'"
            :variant="view === '3d' ? 'soft' : 'outline'"
            :aria-pressed="view === '3d'"
            @click="view = '3d'"
          />
          <UButton
            label="Top view"
            :color="view === 'top' ? 'primary' : 'neutral'"
            :variant="view === 'top' ? 'soft' : 'outline'"
            :aria-pressed="view === 'top'"
            @click="view = 'top'"
          />
        </UFieldGroup>
      </div>
      <div class="relative min-h-0 flex-1">
        <canvas
          v-if="status !== 'unavailable'"
          ref="canvas"
          class="block size-full touch-none"
          aria-hidden="true"
          data-testid="studio-canvas"
        />
        <p
          v-if="status === 'unavailable'"
          class="flex h-full items-center justify-center p-6 text-center text-sm text-muted"
          role="status"
        >
          This browser or device can’t show 3D graphics.
        </p>
        <p
          v-else-if="status === 'loading'"
          class="absolute inset-0 flex items-center justify-center text-sm text-muted"
          role="status"
        >
          Loading the preview…
        </p>
      </div>
      <div class="flex items-center justify-center gap-3 p-3 text-xs text-muted">
        <span>{{ view === '3d' ? 'Drag to rotate · Scroll to zoom' : 'As the floor plan shows it' }}</span>
        <UButton
          label="Reset view"
          icon="i-lucide-rotate-ccw"
          color="neutral"
          variant="outline"
          size="sm"
          class="bg-default"
          @click="resetView"
        />
      </div>
    </main>

    <aside
      aria-label="Customize"
      class="hidden w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-default p-4 md:flex"
    >
      <h2 class="text-base font-semibold text-highlighted">
        Customize
      </h2>
      <UFormField label="Preset name">
        <UInput
          v-model="name"
          class="w-full"
        />
      </UFormField>

      <section class="flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-highlighted">
          Dimensions
        </h3>
        <div class="grid grid-cols-2 gap-3">
          <UFormField :label="round ? 'Diameter (cm)' : 'Width (cm)'">
            <UInputNumber
              :model-value="width"
              :min="30"
              :max="400"
              :step="5"
              @update:model-value="value => setSize(value, size => (width = size))"
            />
          </UFormField>
          <UFormField
            v-if="!round"
            label="Depth (cm)"
          >
            <UInputNumber
              :model-value="depth"
              :min="10"
              :max="400"
              :step="5"
              @update:model-value="value => setSize(value, size => (depth = size))"
            />
          </UFormField>
        </div>
        <p class="text-xs text-muted">
          Height {{ height }} cm{{ preset.category === 'chairs' ? ', seat 45 cm' : '' }}. Legs, rails and cushions keep their thickness at every size.
        </p>
      </section>

      <section
        v-if="preset.category === 'tables' && preset.look.shape !== 'booth'"
        class="flex flex-col gap-3"
      >
        <h3 class="text-sm font-semibold text-highlighted">
          Base style
        </h3>
        <UFieldGroup>
          <UButton
            label="Pedestal"
            :color="base === 'pedestal' ? 'primary' : 'neutral'"
            :variant="base === 'pedestal' ? 'soft' : 'outline'"
            :aria-pressed="base === 'pedestal'"
            @click="base = 'pedestal'"
          />
          <UButton
            label="Four legs"
            :color="base === 'legs' ? 'primary' : 'neutral'"
            :variant="base === 'legs' ? 'soft' : 'outline'"
            :aria-pressed="base === 'legs'"
            @click="base = 'legs'"
          />
        </UFieldGroup>
        <UFormField label="Chairs around it">
          <USelect
            v-model="chair"
            :items="CHAIR_ITEMS"
            class="w-full"
          />
        </UFormField>
        <USwitch
          v-model="withChairs"
          label="Preview with 4 seats"
          description="On the plan, a table gets one chair per seat."
        />
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="text-sm font-semibold text-highlighted">
          Finishes
        </h3>
        <div
          v-for="slot in slots"
          :key="slot.key"
          class="flex flex-col gap-2"
        >
          <p class="text-sm text-highlighted">
            {{ slot.label }} <span class="text-muted">· {{ FINISH_SWATCHES[finishOf(slot)].label }}</span>
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="option in slot.options"
              :key="option"
              type="button"
              class="size-9 rounded-md border border-default ring-offset-2 ring-offset-(--ui-bg) focus-visible:outline-2 focus-visible:outline-primary aria-pressed:ring-2 aria-pressed:ring-primary"
              :style="{ background: FINISH_SWATCHES[option].color }"
              :aria-label="FINISH_SWATCHES[option].label"
              :aria-pressed="finishOf(slot) === option"
              @click="finishes = { ...finishes, [slot.key]: option }"
            />
          </div>
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold text-highlighted">
          Reference photo
        </h3>
        <div class="rounded-lg border border-dashed border-default p-3 text-sm text-muted">
          A real photo, shown in your furniture library and the table details. Comes with step 3b.
        </div>
      </section>

      <div class="mt-auto flex flex-col gap-2">
        <UTooltip text="Saving custom looks comes with step 3a">
          <UButton
            label="Save to library"
            icon="i-lucide-save"
            block
            disabled
          />
        </UTooltip>
        <p class="text-xs text-muted">
          Reusable in every branch of this cafe. Editing a saved look changes every table that uses it.
        </p>
      </div>
    </aside>
  </div>
</template>
