<script setup lang="ts">
/**
 * A cafe's own chair or fixture look (D273, step 3d; the owner's furniture studio references): a
 * name, a kind, its finishes part by part and the size a new piece starts with, with the same
 * generated model the building uses on a turntable. Like a table look it is shared: saving an edit
 * changes every piece placed with it, in every branch; each piece keeps its own size. The kind is
 * chosen once: the pieces saved with a look are of its kind. New looks never take another look's
 * photo (an upload is one look's only).
 * Open via `useOverlay().create(ItemLookFormModal)`; emits `close(look)` with the look as saved.
 */
import type { CreateItemLookInput, CustomItemLook, Finish, ItemLookKind } from '#shared/contracts/shop-layout'
import { heightFits, heightRangeMessage, ITEM_HEIGHTS, ITEM_LOOK_KINDS, ITEM_SIZE_MAX_CM, ITEM_SIZE_MIN_CM, LOOK_NAME_MAX } from '#shared/contracts/shop-layout'
import type { ItemCategory } from '../designer/catalog'
import { FINISH_SWATCHES, ITEM_SPECS, itemFinish } from '../designer/catalog'
import type { StudioViewer } from '../designer/scene/studio-viewer'
import { useItemLookMutations } from '../composables/useBranches'

/** What a new look starts from: a built-in piece, a placed one, or another look (never its photo). */
export interface ItemLookSource {
  kind: ItemLookKind
  finishes: Record<string, Finish>
  width: number
  depth: number
  height: number
}

const props = defineProps<{
  /** The look to edit; omit to add one. */
  look?: CustomItemLook
  from?: ItemLookSource
  /** A new look's kinds: only this category's (Extra seating or Fixtures); every one without it. */
  category?: ItemCategory
}>()
const emit = defineEmits<{ 'close': [saved?: CustomItemLook], 'update:open': [open: boolean] }>()

const CATEGORY_LABELS: Partial<Record<ItemCategory, string>> = { chairs: 'Chairs', fixtures: 'Fixtures' }
const kindItems = computed(() => {
  const categories = (['chairs', 'fixtures'] as const).filter(category => !props.category || props.category === category)
  return categories.flatMap(category => [
    ...(categories.length > 1 ? [{ type: 'label' as const, label: CATEGORY_LABELS[category] }] : []),
    ...ITEM_LOOK_KINDS.filter(kind => ITEM_SPECS[kind].category === category).map(kind => ({ label: ITEM_SPECS[kind].label, value: kind })),
  ])
})

const firstKind = ITEM_LOOK_KINDS.find(kind => !props.category || ITEM_SPECS[kind].category === props.category) ?? ITEM_LOOK_KINDS[0]
const source: ItemLookSource = props.look
  ? { kind: props.look.kind, finishes: props.look.finishes, width: props.look.defaultWidth, depth: props.look.defaultDepth, height: props.look.defaultHeight }
  : props.from ?? { kind: firstKind, finishes: {}, width: ITEM_SPECS[firstKind].width, depth: ITEM_SPECS[firstKind].depth, height: ITEM_HEIGHTS[firstKind].default }

/** Every slot of the kind with a finish: the kind's default where `finishes` has none. */
function slotFinishes(kind: ItemLookKind, finishes: Partial<Record<string, Finish>>): Record<string, Finish> {
  return Object.fromEntries(ITEM_SPECS[kind].slots.map(slot => [slot.key, itemFinish(kind, finishes, slot.key)]))
}

const state = reactive({
  name: props.look?.name ?? '',
  kind: source.kind,
  width: source.width,
  depth: source.depth,
  height: source.height,
  finishes: slotFinishes(source.kind, source.finishes),
  photoId: props.look?.photo?.id,
  photoUrl: props.look?.photo?.url,
})
const saving = ref(false)
/** The photo is being made smaller or uploaded: saving waits for it. */
const uploading = ref(false)
const { isCompact: fullscreen } = useLayoutContext()
const unsaved = useModalUnsavedChanges(state, { paused: saving, close: () => emit('close') })
const { create, update, remove } = useItemLookMutations()

const spec = computed(() => ITEM_SPECS[state.kind])
const round = computed(() => spec.value.footprint === 'round')

// Another kind (a new look only): its own parts and the size it comes in.
watch(() => state.kind, (kind) => {
  state.finishes = slotFinishes(kind, {})
  state.width = ITEM_SPECS[kind].width
  state.depth = ITEM_SPECS[kind].depth
  state.height = ITEM_HEIGHTS[kind].default
})

/** What is saved: the kind's slots only, a round piece as deep as it is wide. */
const body = computed<CreateItemLookInput>(() => ({
  name: state.name.trim(),
  kind: state.kind,
  finishes: { ...state.finishes },
  defaultWidth: state.width,
  defaultDepth: round.value ? state.width : state.depth,
  defaultHeight: state.height,
  photoId: state.photoId ?? null,
}))

const touched = ref(false)
const nameIssue = computed(() => {
  const name = state.name.trim()
  if (!name) return 'Name is required'
  if (name.length > LOOK_NAME_MAX) return `Max ${LOOK_NAME_MAX} characters`
  return undefined
})
const sizeIssue = (size: number) =>
  (!Number.isInteger(size) || size < ITEM_SIZE_MIN_CM || size > ITEM_SIZE_MAX_CM ? `${ITEM_SIZE_MIN_CM} to ${ITEM_SIZE_MAX_CM} cm` : undefined)
const widthIssue = computed(() => sizeIssue(state.width))
const depthIssue = computed(() => (round.value ? undefined : sizeIssue(state.depth)))
const heightIssue = computed(() => (Number.isInteger(state.height) && heightFits(state.kind, state.height) ? undefined : heightRangeMessage(state.kind)))
/** The server's answers, until the name or the photo changes. */
const serverNameIssue = ref<string>()
const serverPhotoIssue = ref<string>()
const serverHeightIssue = ref<string>()
watch(() => state.height, () => (serverHeightIssue.value = undefined))
const serverError = ref<string>()
watch(() => state.name, () => (serverNameIssue.value = undefined))
watch(() => state.photoId, () => (serverPhotoIssue.value = undefined))

async function save() {
  touched.value = true
  if (nameIssue.value || widthIssue.value || depthIssue.value || heightIssue.value || saving.value || uploading.value) return
  saving.value = true
  serverError.value = undefined
  const { kind: _kind, ...fields } = body.value
  const result = props.look
    ? await update.execute({ look: props.look, body: fields })
    : await create.execute(body.value)
  saving.value = false
  if (result.ok) {
    unsaved.markClean()
    emit('close', result.data)
    return
  }
  if (result.status !== 'error') return
  serverNameIssue.value = result.error.fieldErrors?.name?.[0]
  serverHeightIssue.value = result.error.fieldErrors?.defaultHeight?.[0]
  // A photo used meanwhile, or cleaned up after a day unsaved: upload it again.
  serverPhotoIssue.value = result.error.fieldErrors?.photoId?.[0]
  if (!serverNameIssue.value && !serverPhotoIssue.value && !serverHeightIssue.value) serverError.value = result.error.message
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
let viewer: StudioViewer | null = null
let builders: typeof import('../designer/scene/furniture') | null = null

function render() {
  if (!viewer || !builders || widthIssue.value || depthIssue.value || heightIssue.value) return
  const { buildItem } = builders
  const { kind, finishes, defaultWidth, defaultDepth, defaultHeight } = body.value
  viewer.show(context => buildItem(context, { kind, width: defaultWidth, depth: defaultDepth, height: defaultHeight ?? undefined, finishes }))
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
watch(body, render)
watch(() => colorMode.value, value => viewer?.setTheme(value === 'dark'))
watch(view, value => viewer?.setView(value))

const resetView = () => viewer?.reset()
const noun = computed(() => (spec.value.category === 'chairs' ? 'chair' : 'fixture'))
</script>

<template>
  <AppModal
    :title="look ? 'Edit look' : `New ${noun} look`"
    description="For every branch of this cafe. Each piece keeps its own size."
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
              data-testid="item-look-canvas"
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
          id="item-look-form"
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
            v-if="look && look.pieces > 0"
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            :title="`Used by ${look.pieces} ${look.pieces === 1 ? 'piece' : 'pieces'}`"
            :description="`Saving changes ${look.pieces === 1 ? 'it' : 'all of them'}, in every branch.`"
            data-testid="item-look-used"
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
              :placeholder="noun === 'chair' ? 'Rattan chair' : 'Marble bar counter'"
              autofocus
              @blur="touched = true"
            />
          </UFormField>

          <UFormField
            label="Kind"
            :help="look ? 'A look keeps its kind. For another kind, make a new look.' : undefined"
          >
            <USelect
              v-model="state.kind"
              :items="kindItems"
              :disabled="saving || Boolean(look)"
              class="w-full"
            />
          </UFormField>

          <div class="grid grid-cols-2 gap-3">
            <UFormField
              :label="round ? 'Diameter (cm)' : 'Width (cm)'"
              :error="widthIssue"
            >
              <UInputNumber
                v-model="state.width"
                :min="ITEM_SIZE_MIN_CM"
                :max="ITEM_SIZE_MAX_CM"
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
                :min="ITEM_SIZE_MIN_CM"
                :max="ITEM_SIZE_MAX_CM"
                :step="5"
                :disabled="saving"
              />
            </UFormField>
            <UFormField
              label="Height (cm)"
              :help="heightIssue || serverHeightIssue ? undefined : heightRangeMessage(state.kind)"
              :error="(touched && heightIssue) || serverHeightIssue"
            >
              <UInputNumber
                v-model="state.height"
                :min="ITEM_HEIGHTS[state.kind].min"
                :max="ITEM_HEIGHTS[state.kind].max"
                :step="5"
                :disabled="saving"
              />
            </UFormField>
          </div>

          <fieldset class="flex flex-col gap-3">
            <legend class="mb-2 text-sm font-medium text-highlighted">
              Finishes
            </legend>
            <div
              v-for="slot in spec.slots"
              :key="slot.key"
              class="flex flex-col gap-1.5"
              role="group"
              :aria-label="slot.label"
            >
              <p class="text-sm text-toned">
                {{ slot.label }} <span class="text-muted">· {{ FINISH_SWATCHES[state.finishes[slot.key] ?? slot.default].label }}</span>
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="option in slot.options"
                  :key="option"
                  type="button"
                  class="size-9 rounded-md border border-default ring-offset-2 ring-offset-(--ui-bg) focus-visible:outline-2 focus-visible:outline-primary aria-pressed:ring-2 aria-pressed:ring-primary"
                  :style="{ background: FINISH_SWATCHES[option].color }"
                  :aria-label="FINISH_SWATCHES[option].label"
                  :aria-pressed="(state.finishes[slot.key] ?? slot.default) === option"
                  :disabled="saving"
                  @click="state.finishes[slot.key] = option"
                />
              </div>
            </div>
          </fieldset>

          <UFormField
            label="Photo"
            hint="Optional"
            help="A photo of the real piece, shown in the library and the piece’s details."
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
            :disabled="look.pieces > 0 || saving"
            @click="removeLook"
          />
          <span
            v-if="look && look.pieces > 0"
            class="text-xs text-muted"
          >Give its pieces another look to delete it.</span>
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
              form="item-look-form"
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
