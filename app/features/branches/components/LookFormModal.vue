<script setup lang="ts">
/**
 * A cafe's own table look (D273, step 3a; the owner's furniture studio references): a name, a
 * shape, a base, chairs and finishes part by part, with the same generated model the building
 * uses on a turntable. New looks start from another look's values, but never its photo (step 3b):
 * an upload is one look's only. A look is shared: saving an edit changes every table placed with
 * it, in every branch; each table keeps its own size.
 * Open via `useOverlay().create(LookFormModal)`; emits `close(look)` with the look as saved.
 */
import type { CreateLookInput, CustomLook, Finish, LookChair, TableBase, TableLook, TableShape } from '#shared/contracts/shop-layout'
import { LOOK_NAME_MAX, TABLE_SIZE_MAX_CM, TABLE_SIZE_MIN_CM } from '#shared/contracts/shop-layout'
import type { FinishSlot } from '../designer/catalog'
import { BUILT_IN_LOOKS, FINISH_SWATCHES, ITEM_SPECS, lookFinish, TABLE_SLOTS } from '../designer/catalog'
import type { StudioViewer } from '../designer/scene/studio-viewer'
import { useLookMutations } from '../composables/useBranches'

const props = defineProps<{
  /** The look to edit; omit to add one. */
  look?: CustomLook
  /** What a new look starts from (a built-in look, or one of the cafe's). */
  from?: TableLook
}>()
const emit = defineEmits<{ 'close': [saved?: CustomLook], 'update:open': [open: boolean] }>()

const SHAPES: { label: string, value: TableShape }[] = [
  { label: 'Round', value: 'round' },
  { label: 'Rectangle', value: 'rect' },
  { label: 'Booth', value: 'booth' },
]
const BASES: { label: string, value: TableBase }[] = [
  { label: 'Pedestal', value: 'pedestal' },
  { label: 'Four legs', value: 'legs' },
]
const CHAIR_ITEMS: { label: string, value: LookChair }[] = [
  { label: 'Café chair', value: 'cafe-chair' },
  { label: 'Bentwood chair', value: 'bentwood-chair' },
  { label: 'Bar stool', value: 'bar-stool' },
  { label: 'No chairs', value: 'none' },
]

const source = props.look ?? props.from ?? BUILT_IN_LOOKS[0]!
const state = reactive({
  name: props.look?.name ?? '',
  shape: source.shape,
  base: source.base,
  chair: source.chair,
  width: source.defaultWidth,
  depth: source.defaultDepth,
  finishes: {
    top: lookFinish(source, 'top'),
    base: lookFinish(source, 'base'),
    frame: lookFinish(source, 'frame'),
    seat: lookFinish(source, 'seat'),
  } as Record<'top' | 'base' | 'frame' | 'seat', Finish>,
  photoId: props.look?.photo?.id,
  photoUrl: props.look?.photo?.url,
})
const saving = ref(false)
/** The photo is being made smaller or uploaded: saving waits for it. */
const uploading = ref(false)
const { isCompact: fullscreen } = useLayoutContext()
const unsaved = useModalUnsavedChanges(state, { paused: saving, close: () => emit('close') })
const { create, update, remove } = useLookMutations()

const round = computed(() => state.shape === 'round')
const booth = computed(() => state.shape === 'booth')
/** A booth sits on its own benches; a table with no chairs has no seating to finish. */
const seating = computed(() => (booth.value ? ITEM_SPECS['dining-bench'] : state.chair === 'none' ? null : ITEM_SPECS[state.chair]))
const slots = computed<FinishSlot[]>(() => [
  TABLE_SLOTS.top,
  TABLE_SLOTS.base,
  ...(seating.value?.slots ?? []).map(slot => ({ ...slot, label: `Seating: ${slot.label.toLowerCase()}` })),
])
type SlotKey = keyof typeof state.finishes
const finishOf = (slot: FinishSlot) => state.finishes[slot.key as SlotKey]

/** What is saved: only the parts this look has, a round table as deep as it is wide. */
const body = computed<CreateLookInput>(() => {
  const keys = new Set(slots.value.map(slot => slot.key))
  return {
    name: state.name.trim(),
    shape: state.shape,
    base: booth.value ? 'legs' : state.base,
    chair: booth.value ? 'none' : state.chair,
    finishes: {
      top: state.finishes.top,
      base: state.finishes.base,
      ...(keys.has('frame') && { frame: state.finishes.frame }),
      ...(keys.has('seat') && { seat: state.finishes.seat }),
    },
    defaultWidth: state.width,
    defaultDepth: round.value ? state.width : state.depth,
    photoId: state.photoId ?? null,
  }
})

const touched = ref(false)
const nameIssue = computed(() => {
  const name = state.name.trim()
  if (!name) return 'Name is required'
  if (name.length > LOOK_NAME_MAX) return `Max ${LOOK_NAME_MAX} characters`
  return undefined
})
const sizeIssue = (size: number) =>
  (!Number.isInteger(size) || size < TABLE_SIZE_MIN_CM || size > TABLE_SIZE_MAX_CM ? `${TABLE_SIZE_MIN_CM} to ${TABLE_SIZE_MAX_CM} cm` : undefined)
const widthIssue = computed(() => sizeIssue(state.width))
const depthIssue = computed(() => (round.value ? undefined : sizeIssue(state.depth)))
/** The server's answers, until the name or the photo changes. */
const serverNameIssue = ref<string>()
const serverPhotoIssue = ref<string>()
const serverError = ref<string>()
watch(() => state.name, () => (serverNameIssue.value = undefined))
watch(() => state.photoId, () => (serverPhotoIssue.value = undefined))

async function save() {
  touched.value = true
  if (nameIssue.value || widthIssue.value || depthIssue.value || saving.value || uploading.value) return
  saving.value = true
  serverError.value = undefined
  const result = props.look
    ? await update.execute({ look: props.look, body: body.value })
    : await create.execute(body.value)
  saving.value = false
  if (result.ok) {
    unsaved.markClean()
    emit('close', result.data)
    return
  }
  if (result.status !== 'error') return
  serverNameIssue.value = result.error.fieldErrors?.name?.[0]
  // A photo used meanwhile, or cleaned up after a day unsaved: upload it again.
  serverPhotoIssue.value = result.error.fieldErrors?.photoId?.[0]
  if (!serverNameIssue.value && !serverPhotoIssue.value) serverError.value = result.error.message
}

async function removeLook() {
  if (!props.look) return
  const result = await remove.execute({ look: props.look })
  if (result.ok) emit('close')
}

useSubmitShortcut(save)

// --- The preview: the model the building draws, on a turntable. ---

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const colorMode = useColorMode()
const preview = ref<'loading' | 'ready' | 'unavailable'>('loading')
const view = ref<'3d' | 'top'>('3d')
const withSeats = ref(true)
let viewer: StudioViewer | null = null
let builders: typeof import('../designer/scene/furniture') | null = null

function render() {
  if (!viewer || !builders || widthIssue.value || depthIssue.value) return
  const { buildTable } = builders
  const { shape, base, chair, finishes, defaultWidth, defaultDepth } = body.value
  const look: TableLook = { id: 'preview', name: '', shape, base, chair: withSeats.value ? chair : 'none', finishes, defaultWidth, defaultDepth }
  const seats = withSeats.value ? 4 : 0
  viewer.show(context => buildTable(context, look, defaultWidth, defaultDepth, seats))
}

onMounted(async () => {
  try {
    const [{ createStudioViewer }, furniture] = await Promise.all([import('../designer/scene/studio-viewer'), import('../designer/scene/furniture')])
    if (!canvas.value) return
    builders = furniture
    viewer = createStudioViewer({ canvas: canvas.value, dark: colorMode.value === 'dark', onContextLost: () => (preview.value = 'unavailable') })
    render()
    preview.value = 'ready'
  }
  catch {
    preview.value = 'unavailable'
  }
})
onBeforeUnmount(() => viewer?.dispose())
watch([body, withSeats], render)
watch(() => colorMode.value, value => viewer?.setTheme(value === 'dark'))
watch(view, value => viewer?.setView(value))

const resetView = () => viewer?.reset()
</script>

<template>
  <AppModal
    :title="look ? 'Edit look' : 'New look'"
    description="For every branch of this cafe. Each table keeps its own size."
    :fullscreen="fullscreen"
    :ui="{ content: 'sm:max-w-4xl' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <div class="grid gap-5 md:grid-cols-[minmax(0,1fr)_20rem]">
        <section
          aria-label="Preview"
          class="relative flex h-60 flex-col overflow-hidden rounded-lg bg-muted md:h-auto md:min-h-104"
        >
          <div class="relative min-h-0 flex-1">
            <canvas
              v-if="preview !== 'unavailable'"
              ref="canvas"
              class="block size-full touch-none"
              aria-hidden="true"
              data-testid="look-canvas"
            />
            <p
              v-if="preview === 'unavailable'"
              class="flex h-full items-center justify-center p-6 text-center text-sm text-muted"
              role="status"
            >
              This browser or device can’t show the 3D preview. The look still saves.
            </p>
            <p
              v-else-if="preview === 'loading'"
              class="absolute inset-0 flex items-center justify-center text-sm text-muted"
              role="status"
            >
              Loading the preview…
            </p>
          </div>
          <div class="absolute inset-x-2 top-2 flex items-center justify-between gap-2">
            <UFieldGroup
              size="sm"
              class="rounded-md bg-default"
            >
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
            <UButton
              icon="i-lucide-rotate-ccw"
              color="neutral"
              variant="outline"
              size="sm"
              class="bg-default"
              aria-label="Reset view"
              @click="resetView"
            />
          </div>
        </section>

        <form
          id="look-form"
          class="flex flex-col gap-4"
          novalidate
          @submit.prevent="save"
        >
          <UAlert
            v-if="serverError"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="The look wasn't saved"
            :description="serverError"
          />
          <UAlert
            v-if="look && look.tables > 0"
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            :title="`Used by ${look.tables} ${look.tables === 1 ? 'table' : 'tables'}`"
            :description="`Saving changes ${look.tables === 1 ? 'it' : 'all of them'}, in every branch.`"
            data-testid="look-used"
          />
          <UFormField
            label="Name"
            required
            :error="serverNameIssue ?? (touched ? nameIssue : undefined)"
          >
            <UInput
              v-model="state.name"
              :disabled="saving"
              autocomplete="off"
              class="w-full"
              placeholder="Walnut window table"
              autofocus
              @blur="touched = true"
            />
          </UFormField>

          <UFormField label="Shape">
            <UFieldGroup
              role="group"
              aria-label="Shape"
            >
              <UButton
                v-for="option in SHAPES"
                :key="option.value"
                :label="option.label"
                :color="state.shape === option.value ? 'primary' : 'neutral'"
                :variant="state.shape === option.value ? 'soft' : 'outline'"
                :aria-pressed="state.shape === option.value"
                :disabled="saving"
                @click="state.shape = option.value"
              />
            </UFieldGroup>
          </UFormField>

          <div class="grid grid-cols-2 gap-3">
            <UFormField
              :label="round ? 'Diameter (cm)' : 'Width (cm)'"
              :error="widthIssue"
            >
              <UInputNumber
                v-model="state.width"
                :min="TABLE_SIZE_MIN_CM"
                :max="TABLE_SIZE_MAX_CM"
                :step="5"
                :disabled="saving"
              />
            </UFormField>
            <UFormField
              v-if="!round"
              label="Depth (cm)"
              :error="depthIssue"
            >
              <UInputNumber
                v-model="state.depth"
                :min="TABLE_SIZE_MIN_CM"
                :max="TABLE_SIZE_MAX_CM"
                :step="5"
                :disabled="saving"
              />
            </UFormField>
          </div>

          <template v-if="!booth">
            <UFormField label="Base">
              <UFieldGroup
                role="group"
                aria-label="Base"
              >
                <UButton
                  v-for="option in BASES"
                  :key="option.value"
                  :label="option.label"
                  :color="state.base === option.value ? 'primary' : 'neutral'"
                  :variant="state.base === option.value ? 'soft' : 'outline'"
                  :aria-pressed="state.base === option.value"
                  :disabled="saving"
                  @click="state.base = option.value"
                />
              </UFieldGroup>
            </UFormField>
            <UFormField
              label="Chairs"
              help="One for each of the table's seats."
            >
              <USelect
                v-model="state.chair"
                :items="CHAIR_ITEMS"
                :disabled="saving"
                class="w-full"
              />
            </UFormField>
          </template>

          <fieldset class="flex flex-col gap-3">
            <legend class="mb-2 text-sm font-medium text-highlighted">
              Finishes
            </legend>
            <div
              v-for="slot in slots"
              :key="slot.key"
              class="flex flex-col gap-1.5"
              role="group"
              :aria-label="slot.label"
            >
              <p class="text-sm text-toned">
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
                  :disabled="saving"
                  @click="state.finishes[slot.key as SlotKey] = option"
                />
              </div>
            </div>
          </fieldset>

          <UFormField
            label="Photo"
            hint="Optional"
            help="A photo of the real piece, shown in the picker and the table’s details."
            :error="serverPhotoIssue"
          >
            <ImageInput
              v-model:image-url="state.photoUrl"
              v-model:image-id="state.photoId"
              v-model:uploading="uploading"
              :crop-ratio="4 / 3"
              :disabled="saving"
              alt="Photo of the look"
              noun="photo"
            />
          </UFormField>

          <USwitch
            v-model="withSeats"
            label="Preview with 4 seats"
          />
        </form>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <UButton
            v-if="look"
            label="Delete"
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            :disabled="look.tables > 0 || saving"
            @click="removeLook"
          />
          <span
            v-if="look && look.tables > 0"
            class="text-xs text-muted"
          >Give its tables another look to delete it.</span>
        </div>
        <div class="flex gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            @click="unsaved.requestClose()"
          />
          <UTooltip
            :text="look ? 'Save' : 'Save look'"
            :kbds="['meta', 'enter']"
          >
            <UButton
              type="submit"
              form="look-form"
              :label="look ? 'Save' : 'Save look'"
              :loading="saving"
              :disabled="uploading || (Boolean(look) && !unsaved.isDirty.value)"
            />
          </UTooltip>
        </div>
      </div>
    </template>
  </AppModal>
</template>
