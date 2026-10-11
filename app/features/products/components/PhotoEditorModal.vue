<script setup lang="ts">
/**
 * Add or edit a menu item's photo (D158). The owner picks a photo (or drops or pastes one, or takes
 * one on a phone), clicks the middle of the dish, and sees it as customers will: the square
 * **Menu card** and the 4:3 **Item page**, both suggested from that point (the item page keeps
 * the whole photo unless filling 4:3 cuts very little). **Adjust** on a preview moves and zooms
 * that one view (drag, the slider, arrow keys, + and −); **Reset** suggests it again. **Rotate**
 * turns a sideways photo. **Use photo** makes the files in the browser, uploads them and closes
 * with the photo: the menu item's own Save publishes it.
 *
 * Opened with `useOverlay`: `await overlay.create(PhotoEditorModal).open({ name, photoId }).result`
 * is the uploaded photo, or `null` when closed without one.
 */
import { useEventListener, useFileDialog } from '@vueuse/core'
import type { PhotoEdit, UploadedPhoto } from '#shared/contracts/media'
import { IMAGE_TYPES } from '#shared/contracts/media'
import { fetchPhotoFile, fetchPhotoForEdit, usePhotoUpload } from '../composables/usePhotos'
import type { ViewName } from '../utils/photo'
import { frameOf, isSmallPhoto, MAX_ZOOM, minZoom, moveView, newEdit, placementStyle, placePhoto, resetView, VIEW_RATIOS, withFocus, zoomView } from '../utils/photo'
import type { PhotoSource } from '../utils/photo-canvas'
import { fillOf, loadPhoto, photoUpload, rotatePhoto, sourceUrl } from '../utils/photo-canvas'

const props = defineProps<{
  /** The item's name, shown in the previews. */
  name?: string
  /** The photo to edit again (the item's `imageId`); without it, a new photo. */
  photoId?: string
}>()
const emit = defineEmits<{ 'close': [photo: UploadedPhoto | null], 'update:open': [open: boolean] }>()

const { isCompact } = useLayoutContext()
const VIEWS: { name: ViewName, label: string, hint: string }[] = [
  { name: 'card', label: 'Menu card', hint: 'On the menu, in checkout and orders' },
  { name: 'detail', label: 'Item page', hint: 'When a customer opens the item' },
]

type Phase = 'pick' | 'loading' | 'edit'
const phase = ref<Phase>(props.photoId ? 'loading' : 'pick')
const source = shallowRef<PhotoSource | null>(null)
const imageUrl = ref<string | null>(null)
const edit = ref<PhotoEdit | null>(null)
const adjusting = ref<ViewName | null>(null)
const problem = ref<string>()
/** Bumped for every new photo: picking one is a change to ask about before closing. */
const picked = ref(0)

const upload = usePhotoUpload()
const editorKey = useId()
const saving = ref(false)
const busy = computed(() => saving.value || upload.isPending(editorKey))

const unsaved = useModalUnsavedChanges(() => ({ picked: picked.value, edit: edit.value }), {
  paused: busy,
  close: () => emit('close', null),
})

onBeforeUnmount(() => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
})

async function show(next: PhotoSource, nextEdit?: PhotoEdit) {
  const url = await sourceUrl(next)
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = url
  source.value = next
  edit.value = nextEdit ?? newEdit(next.size, fillOf(next))
  adjusting.value = null
  phase.value = 'edit'
}

// --- Picking a photo ---
const MAX_ORIGINAL_MB = IMAGE_MAX_ORIGINAL_BYTES / 1024 / 1024

async function takeFile(file: File | undefined) {
  if (!file || busy.value) return
  problem.value = undefined
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    problem.value = 'Use a JPEG, PNG or WebP photo.'
    return
  }
  if (file.size > IMAGE_MAX_ORIGINAL_BYTES) {
    problem.value = `This photo is larger than ${MAX_ORIGINAL_MB} MB. Choose a smaller one.`
    return
  }
  const before = phase.value
  phase.value = 'loading'
  try {
    await show(await loadPhoto(file))
    picked.value++
  }
  catch {
    problem.value = 'This photo can\'t be opened here. Save it as a JPEG or PNG, or choose another one.'
    phase.value = before === 'edit' && source.value ? 'edit' : 'pick'
  }
}

const library = useFileDialog({ accept: IMAGE_TYPES.join(','), multiple: false, reset: true })
library.onChange(files => takeFile(files?.[0]))
const camera = useFileDialog({ accept: 'image/*', capture: 'environment', multiple: false, reset: true })
camera.onChange(files => takeFile(files?.[0]))

const dragging = ref(false)
function onDrop(event: DragEvent) {
  dragging.value = false
  void takeFile(event.dataTransfer?.files[0])
}
// A photo copied elsewhere and pasted here (Ctrl/⌘+V), before one is chosen.
if (import.meta.client) {
  useEventListener(window, 'paste', (event: ClipboardEvent) => {
    if (phase.value !== 'pick') return
    const file = [...(event.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/'))
    if (file) void takeFile(file)
  })
}

// --- Editing a photo again ---
onMounted(async () => {
  if (!props.photoId) return
  try {
    const photo = await fetchPhotoForEdit(props.photoId)
    const loaded = await loadPhoto(await fetchPhotoFile(photo))
    await show(loaded, photo.edit ?? undefined)
    unsaved.markClean()
  }
  catch {
    problem.value = 'This photo couldn\'t be opened. Choose it again, or another one.'
    phase.value = 'pick'
  }
})

// --- The focus point ---
const stage = useTemplateRef<HTMLElement>('stage')
const ratioOf = (view: ViewName | 'source') => (view === 'source' ? (source.value ? source.value.size.width / source.value.size.height : 1) : VIEW_RATIOS[view])
const boxStyle = (ratio: number) => ({ aspectRatio: String(ratio), width: `min(100%, calc(min(55dvh, 28rem) * ${ratio}))` })

function setFocus(event: MouseEvent) {
  if (!source.value || !edit.value || !stage.value) return
  const rect = stage.value.getBoundingClientRect()
  edit.value = withFocus(source.value.size, edit.value, { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height })
}
const STEP = 0.02
function moveFocus(event: KeyboardEvent) {
  if (!source.value || !edit.value) return
  const delta = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[event.key]
  if (!delta) return
  event.preventDefault()
  edit.value = withFocus(source.value.size, edit.value, { x: edit.value.focus.x + delta[0]!, y: edit.value.focus.y + delta[1]! })
}

function rotate(direction: 1 | -1) {
  if (!source.value) return
  void show(rotatePhoto(source.value, direction))
}

// --- Adjusting one view ---
const frameEl = useTemplateRef<HTMLElement>('frame')
let last: { x: number, y: number } | null = null

function startDrag(event: PointerEvent) {
  last = { x: event.clientX, y: event.clientY }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function drag(event: PointerEvent) {
  if (!last || !adjusting.value || !frameEl.value) return
  const rect = frameEl.value.getBoundingClientRect()
  move((event.clientX - last.x) / rect.height, (event.clientY - last.y) / rect.height)
  last = { x: event.clientX, y: event.clientY }
}
function endDrag() {
  last = null
}
function move(dx: number, dy: number) {
  if (!source.value || !edit.value || !adjusting.value) return
  const view = adjusting.value
  edit.value = { ...edit.value, [view]: moveView(source.value.size, view, edit.value[view], dx, dy) }
}
const zoom = computed({
  get: () => (edit.value && adjusting.value ? edit.value[adjusting.value].zoom : 1),
  set: (value: number) => {
    if (!source.value || !edit.value || !adjusting.value) return
    const view = adjusting.value
    edit.value = { ...edit.value, [view]: zoomView(source.value.size, view, edit.value[view], value) }
  },
})
const zoomMin = computed(() => (source.value && adjusting.value ? minZoom(source.value.size, adjusting.value) : 1))
function adjustKeys(event: KeyboardEvent) {
  const moves: Record<string, [number, number]> = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }
  if (moves[event.key]) {
    event.preventDefault()
    move(...moves[event.key]!)
  }
  else if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    zoom.value += 0.1
  }
  else if (event.key === '-') {
    event.preventDefault()
    zoom.value -= 0.1
  }
}
function onWheel(event: WheelEvent) {
  event.preventDefault()
  zoom.value *= 1 - Math.max(-0.2, Math.min(0.2, event.deltaY * 0.002))
}
function reset(view: ViewName) {
  if (source.value && edit.value) edit.value = resetView(source.value.size, edit.value, view)
}

/** Where the photo sits in a view's frame, as CSS. */
function photoStyle(view: ViewName) {
  if (!source.value || !edit.value) return {}
  const frame = frameOf(view)
  return placementStyle(placePhoto(source.value.size, frame, edit.value[view]), frame)
}

const small = computed(() => source.value && isSmallPhoto(source.value.size))

// --- Use photo ---
async function usePhoto() {
  if (!source.value || !edit.value || busy.value) return
  problem.value = undefined
  saving.value = true
  let body: FormData
  try {
    body = await photoUpload(source.value, edit.value)
  }
  catch {
    saving.value = false
    problem.value = 'This browser couldn\'t prepare the photo. Try again, or choose another one.'
    return
  }
  const result = await upload.execute({ body, editor: editorKey })
  saving.value = false
  if (!result.ok) {
    if (result.status === 'error') problem.value = result.error.message
    return
  }
  unsaved.markClean()
  emit('close', result.data)
}
</script>

<template>
  <UModal
    :title="photoId ? 'Edit photo' : 'Add photo'"
    description="Mark the middle of the dish, check how customers will see it, then use it."
    :fullscreen="isCompact"
    :dismissible="!busy"
    :ui="{ content: 'sm:max-w-5xl', footer: 'justify-between gap-2 pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <!-- Picking a photo -->
      <div
        v-if="phase === 'pick'"
        class="space-y-4"
      >
        <div
          class="flex min-h-72 flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-6 text-center transition-colors"
          :class="dragging ? 'border-primary bg-primary/5' : 'border-default'"
          data-testid="photo-drop"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <UIcon
            name="i-lucide-image-plus"
            class="size-10 text-dimmed"
          />
          <div class="space-y-1">
            <p class="font-medium text-highlighted">
              {{ isCompact ? 'Take a photo or choose one' : 'Drop a photo here, paste it, or choose one' }}
            </p>
            <p class="text-sm text-muted">
              JPEG, PNG or WebP. It's made the right size for the menu.
            </p>
          </div>
          <div class="flex flex-wrap justify-center gap-2">
            <UButton
              v-if="isCompact"
              label="Take photo"
              icon="i-lucide-camera"
              @click="camera.open()"
            />
            <UButton
              label="Choose photo"
              icon="i-lucide-upload"
              :color="isCompact ? 'neutral' : 'primary'"
              :variant="isCompact ? 'outline' : 'solid'"
              @click="library.open()"
            />
          </div>
        </div>
        <UAlert
          v-if="problem"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="problem"
        />
        <p class="flex items-center gap-2 text-sm text-muted">
          <UIcon
            name="i-lucide-lightbulb"
            class="size-4 shrink-0"
          />
          Photos that sell: daylight, the dish in the middle, a plain background.
        </p>
      </div>

      <!-- Preparing it -->
      <div
        v-else-if="phase === 'loading'"
        class="flex min-h-72 flex-col items-center justify-center gap-3"
        aria-busy="true"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-8 animate-spin text-muted"
        />
        <p class="text-sm text-muted">
          Preparing the photo…
        </p>
      </div>

      <!-- Editing it -->
      <div
        v-else-if="source && edit && imageUrl"
        class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
      >
        <section
          class="min-w-0 space-y-3"
          :aria-label="adjusting ? `Adjust the ${adjusting === 'card' ? 'menu card' : 'item page'}` : 'The photo'"
        >
          <template v-if="!adjusting">
            <p class="text-sm font-medium text-highlighted">
              {{ isCompact ? 'Tap' : 'Click' }} the middle of the dish
            </p>
            <div
              ref="stage"
              class="relative mx-auto cursor-crosshair touch-none overflow-hidden rounded-lg bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
              :style="boxStyle(ratioOf('source'))"
              role="group"
              tabindex="0"
              aria-label="The photo. Click the middle of the dish, or move the point with the arrow keys."
              data-testid="photo-stage"
              @click="setFocus"
              @keydown="moveFocus"
            >
              <img
                :src="imageUrl"
                alt=""
                class="size-full select-none object-contain"
                draggable="false"
              >
              <span
                class="pointer-events-none absolute size-7 -translate-1/2 rounded-full border-2 border-white bg-primary/40 shadow ring-2 ring-primary"
                :style="{ left: `${edit.focus.x * 100}%`, top: `${edit.focus.y * 100}%` }"
                aria-hidden="true"
              />
            </div>
            <div class="flex flex-wrap items-center justify-center gap-2">
              <UButton
                label="Rotate left"
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="rotate(-1)"
              />
              <UButton
                label="Rotate right"
                icon="i-lucide-rotate-cw"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="rotate(1)"
              />
            </div>
          </template>

          <template v-else>
            <div class="flex items-center justify-between gap-2">
              <p class="text-sm font-medium text-highlighted">
                {{ adjusting === 'card' ? 'Menu card' : 'Item page' }}: drag to move, zoom to fit
              </p>
              <div class="flex gap-1">
                <UButton
                  label="Reset"
                  icon="i-lucide-undo-2"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  @click="reset(adjusting)"
                />
                <UButton
                  label="Done"
                  size="sm"
                  @click="adjusting = null"
                />
              </div>
            </div>
            <div
              ref="frame"
              class="relative mx-auto cursor-grab touch-none overflow-hidden rounded-lg ring-1 ring-default focus-visible:outline-2 focus-visible:outline-primary active:cursor-grabbing"
              :style="{ ...boxStyle(ratioOf(adjusting)), backgroundColor: edit.fill }"
              role="group"
              tabindex="0"
              aria-label="Move the photo: drag it, or use the arrow keys. Plus and minus zoom."
              data-testid="photo-frame"
              @pointerdown="startDrag"
              @pointermove="drag"
              @pointerup="endDrag"
              @pointercancel="endDrag"
              @wheel="onWheel"
              @keydown="adjustKeys"
            >
              <img
                :src="imageUrl"
                alt=""
                class="absolute max-w-none select-none"
                :style="photoStyle(adjusting)"
                draggable="false"
              >
            </div>
            <div class="mx-auto flex w-full max-w-md items-center gap-3">
              <UIcon
                name="i-lucide-zoom-out"
                class="size-4 shrink-0 text-muted"
              />
              <USlider
                v-model="zoom"
                :min="zoomMin"
                :max="MAX_ZOOM"
                :step="0.01"
                aria-label="Zoom"
                class="flex-1"
              />
              <UIcon
                name="i-lucide-zoom-in"
                class="size-4 shrink-0 text-muted"
              />
            </div>
          </template>

          <UAlert
            v-if="small"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="This photo is small"
            description="It may look blurry on the item page. A larger photo looks sharper."
          />
          <UAlert
            v-if="problem"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="problem"
          />
        </section>

        <!-- How customers will see it -->
        <section
          class="space-y-5"
          aria-label="How customers see it"
        >
          <div
            v-for="view in VIEWS"
            :key="view.name"
            class="space-y-2"
            :data-testid="`photo-preview-${view.name}`"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="text-sm font-medium text-highlighted">
                  {{ view.label }}
                </p>
                <p class="text-xs text-muted">
                  {{ view.hint }}
                </p>
              </div>
              <UButton
                :label="adjusting === view.name ? 'Adjusting' : 'Adjust'"
                :aria-label="`Adjust the ${view.label.toLowerCase()}`"
                icon="i-lucide-move"
                color="neutral"
                :variant="adjusting === view.name ? 'soft' : 'outline'"
                size="xs"
                @click="adjusting = view.name"
              />
            </div>
            <!-- The menu card as on the menu: the square beside the name. -->
            <div
              v-if="view.name === 'card'"
              class="flex items-center gap-3 rounded-lg border border-default bg-default p-3"
            >
              <div
                class="relative size-24 shrink-0 overflow-hidden rounded-md"
                :style="{ backgroundColor: edit.fill }"
              >
                <img
                  :src="imageUrl"
                  alt=""
                  class="absolute max-w-none"
                  :style="photoStyle('card')"
                >
              </div>
              <div class="min-w-0 space-y-1">
                <p class="truncate font-medium text-highlighted">
                  {{ name || 'Menu item' }}
                </p>
                <p class="text-sm text-muted">
                  Add to order
                </p>
              </div>
            </div>
            <!-- The item page's photo, 4:3 over its name. -->
            <div
              v-else
              class="overflow-hidden rounded-lg border border-default bg-default"
            >
              <div
                class="relative aspect-4/3 overflow-hidden"
                :style="{ backgroundColor: edit.fill }"
              >
                <img
                  :src="imageUrl"
                  alt=""
                  class="absolute max-w-none"
                  :style="photoStyle('detail')"
                >
              </div>
              <p class="truncate p-3 font-medium text-highlighted">
                {{ name || 'Menu item' }}
              </p>
            </div>
          </div>
        </section>
      </div>
    </template>

    <template #footer>
      <UButton
        v-if="phase === 'edit'"
        label="Choose another"
        icon="i-lucide-image"
        color="neutral"
        variant="ghost"
        :disabled="busy"
        @click="library.open()"
      />
      <span v-else />
      <div class="flex gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          :disabled="busy"
          @click="unsaved.requestClose()"
        />
        <UButton
          label="Use photo"
          :loading="busy"
          :disabled="phase !== 'edit'"
          @click="usePhoto"
        />
      </div>
    </template>
  </UModal>
</template>
