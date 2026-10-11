<script setup lang="ts">
/**
 * Add or edit a menu item's photo (D158, D161). The owner picks a photo (or drops or pastes one, or
 * takes one on a phone) and frames it like a crop: **Menu card** (square) and **Item page** (4:3)
 * are tabs over one frame, the photo dragged and zoomed inside it (the slider, the wheel, arrow
 * keys, + and −), the part left out dimmed around it; **Reset** suggests the view again. Both start
 * suggested (the item page keeps the whole photo unless filling 4:3 cuts very little), and the item
 * page follows the menu card's middle until it is framed itself. The previews show both as
 * customers will; clicking one frames it. **Rotate** turns the frame at once and the photo with it. **Use photo** makes the files in the browser and closes at once with
 * them: the form's photo field uploads them, showing it on the preview (`MenuPhotoField`), and the
 * menu item's own Save publishes it.
 *
 * Opened with `useOverlay`, a new instance each time (`destroyOnClose`):
 * `await overlay.create(PhotoEditorModal, { destroyOnClose: true }).open({ name, photoId }).result`
 * is the prepared photo, or `null` when closed without one.
 */
import { useEventListener, useFileDialog } from '@vueuse/core'
import type { PhotoEdit, PhotoView } from '#shared/contracts/media'
import { IMAGE_TYPES } from '#shared/contracts/media'
import { fetchPhotoFile, fetchPhotoForEdit } from '../composables/usePhotos'
import type { ViewName } from '../utils/photo'
import { frameOf, isSmallPhoto, MAX_ZOOM, minZoom, moveView, newEdit, placementStyle, placePhoto, resetView, VIEW_RATIOS, withFocus, zoomView } from '../utils/photo'
import type { PhotoSource, PreparedPhoto } from '../utils/photo-canvas'
import { fillOf, loadPhoto, preparePhoto, rotatePhoto, sourceUrl } from '../utils/photo-canvas'

const props = defineProps<{
  /** The item's name, shown in the previews. */
  name?: string
  /** The photo to edit again (the item's `imageId`); without it, a new photo. */
  photoId?: string
  /** A photo used but still uploading (or whose upload failed): opened from memory, as it was left. */
  photo?: PreparedPhoto
}>()
const emit = defineEmits<{ 'close': [photo: PreparedPhoto | null], 'update:open': [open: boolean] }>()

const { isCompact } = useLayoutContext()
const VIEWS: { name: ViewName, label: string, shape: string }[] = [
  { name: 'card', label: 'Menu card', shape: 'Square' },
  { name: 'detail', label: 'Item page', shape: '4:3' },
]
const VIEW_TABS = VIEWS.map(item => ({ label: item.label, value: item.name }))

type Phase = 'pick' | 'loading' | 'edit'
const phase = ref<Phase>(props.photoId || props.photo ? 'loading' : 'pick')
const source = shallowRef<PhotoSource | null>(null)
const imageUrl = ref<string | null>(null)
const edit = ref<PhotoEdit | null>(null)
/** The view framed in the large area; its preview is marked. */
const view = ref<ViewName>('card')
const problem = ref<string>()
/** Bumped for every new photo: picking one is a change to ask about before closing. */
const picked = ref(0)

/** Making the files from the photo (a moment), after Use photo. */
const saving = ref(false)
const busy = computed(() => saving.value)

const unsaved = useModalUnsavedChanges(() => ({ picked: picked.value, edit: edit.value }), {
  paused: busy,
  close: () => emit('close', null),
})

onBeforeUnmount(() => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
})

/** Shows a photo; `url` when its display copy is already made (a turn). */
async function show(next: PhotoSource, nextEdit?: PhotoEdit, url?: string) {
  const shown = url ?? await sourceUrl(next)
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = shown
  source.value = next
  edit.value = nextEdit ?? newEdit(next.size, fillOf(next))
  view.value = 'card'
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
  if (props.photo) {
    await show(props.photo.source, props.photo.edit)
    unsaved.markClean()
    return
  }
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

// --- Turning the photo ---
const ratioOf = (name: ViewName) => VIEW_RATIOS[name]
const boxStyle = (ratio: number) => ({ aspectRatio: String(ratio), width: `min(100%, calc(min(${isCompact.value ? '30dvh' : '50dvh'}, 26rem) * ${ratio}))` })

/** A quarter turn on its way: the frame turns on screen at once while the photo is redrawn. */
const turning = ref<0 | 1 | -1>(0)
const TURN_MS = 200
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

async function rotate(direction: 1 | -1) {
  if (!source.value || turning.value) return
  turning.value = direction
  // Let the turn start before the redraw takes the main thread.
  await nextFrame()
  const started = performance.now()
  try {
    const next = rotatePhoto(source.value, direction)
    const url = await sourceUrl(next)
    // Decoded before it's shown, so the turned photo appears without a blank moment.
    const image = new Image()
    image.src = url
    await image.decode().catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, Math.max(0, TURN_MS - (performance.now() - started))))
    await show(next, undefined, url)
  }
  finally {
    turning.value = 0
  }
}

// --- Framing one view ---
const frameEl = useTemplateRef<HTMLElement>('frame')
let last: { x: number, y: number } | null = null
/** While the photo is dragged: the thirds grid shows. */
const panning = ref(false)

function startDrag(event: PointerEvent) {
  last = { x: event.clientX, y: event.clientY }
  panning.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function drag(event: PointerEvent) {
  if (!last || !frameEl.value) return
  const rect = frameEl.value.getBoundingClientRect()
  move((event.clientX - last.x) / rect.height, (event.clientY - last.y) / rect.height)
  last = { x: event.clientX, y: event.clientY }
}
function endDrag() {
  last = null
  panning.value = false
}

/**
 * The framed view changed by hand. The menu card's middle is also the point the item page follows
 * while it isn't framed by hand (the saved edit's `focus`).
 */
function setView(next: PhotoView) {
  if (!source.value || !edit.value) return
  const changed = { ...edit.value, [view.value]: next }
  edit.value = view.value === 'card' ? withFocus(source.value.size, changed, { x: next.x, y: next.y }) : changed
}
function move(dx: number, dy: number) {
  if (!source.value || !edit.value) return
  setView(moveView(source.value.size, view.value, edit.value[view.value], dx, dy))
}
const zoom = computed({
  get: () => edit.value?.[view.value].zoom ?? 1,
  set: (value: number) => {
    if (!source.value || !edit.value) return
    setView(zoomView(source.value.size, view.value, edit.value[view.value], value))
  },
})
const zoomMin = computed(() => (source.value ? minZoom(source.value.size, view.value) : 1))
const STEP = 0.02
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
/** Reset: the view suggested again (the menu card from the photo's middle; the item page then follows it). */
function reset() {
  if (!source.value || !edit.value) return
  const size = source.value.size
  edit.value = view.value === 'card'
    ? withFocus(size, { ...edit.value, card: { ...edit.value.card, adjusted: false } }, { x: 0.5, y: 0.5 })
    : resetView(size, edit.value, 'detail')
}
/** Under a preview: where customers see it, and for the item page whether the whole photo shows. */
function captionOf(name: ViewName) {
  if (name === 'card' || !source.value || !edit.value) return { lead: 'On the menu, in checkout and orders', where: '' }
  const frame = frameOf('detail')
  const placed = placePhoto(source.value.size, frame, edit.value.detail)
  const whole = placed.width <= frame.width + 1e-6 && placed.height <= frame.height + 1e-6
  return { lead: whole ? 'The whole photo' : 'Cropped to fill', where: ', when a customer opens the item' }
}
const framedByHand = computed(() => Boolean(edit.value?.[view.value].adjusted))

/** Where the photo sits in a view's frame, as CSS. */
function photoStyle(name: ViewName) {
  if (!source.value || !edit.value) return {}
  const frame = frameOf(name)
  return placementStyle(placePhoto(source.value.size, frame, edit.value[name]), frame)
}

const small = computed(() => source.value && isSmallPhoto(source.value.size))

// --- Use photo ---
async function usePhoto() {
  if (!source.value || !edit.value || busy.value) return
  problem.value = undefined
  saving.value = true
  try {
    const prepared = await preparePhoto(source.value, edit.value)
    unsaved.markClean()
    emit('close', prepared)
  }
  catch {
    problem.value = 'This browser couldn\'t prepare the photo. Try again, or choose another one.'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :title="photoId || photo ? 'Edit photo' : 'Add photo'"
    description="Adjust how your photo looks to customers, then use it."
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
        class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-0"
      >
        <section
          class="min-w-0 space-y-3 lg:pr-6"
          aria-labelledby="photo-adjust-title"
        >
          <div class="flex min-h-8 flex-wrap items-center justify-between gap-2">
            <h3
              id="photo-adjust-title"
              class="font-semibold text-highlighted max-sm:sr-only"
            >
              Adjust photo
            </h3>
            <UTabs
              v-model="view"
              :items="VIEW_TABS"
              :content="false"
              size="sm"
              aria-label="Which view to frame"
              class="max-sm:w-full"
            />
          </div>

          <!-- The frame, with the part of the photo left out dimmed around it. -->
          <div
            class="overflow-hidden rounded-lg border border-default bg-elevated/50 px-6 py-4 sm:px-10 sm:py-8"
            data-testid="photo-stage"
          >
            <div
              class="transition-transform ease-out motion-reduce:transition-none"
              :class="turning ? 'duration-200' : 'duration-0'"
              :style="{ transform: `rotate(${turning * 90}deg)` }"
            >
              <div
                ref="frame"
                class="relative mx-auto cursor-grab touch-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary active:cursor-grabbing"
                :style="boxStyle(ratioOf(view))"
                role="group"
                tabindex="0"
                :aria-label="`Frame the ${view === 'card' ? 'menu card' : 'item page'}: drag the photo, or use the arrow keys. Plus and minus zoom.`"
                :data-photo="`${source.size.width}x${source.size.height}`"
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
                  class="pointer-events-none absolute max-w-none opacity-30 select-none"
                  :style="photoStyle(view)"
                  draggable="false"
                >
                <div
                  class="absolute inset-0 overflow-hidden rounded-md"
                  :style="{ backgroundColor: edit.fill }"
                >
                  <img
                    :src="imageUrl"
                    alt=""
                    class="absolute max-w-none select-none"
                    :style="photoStyle(view)"
                    draggable="false"
                  >
                </div>
                <div
                  class="pointer-events-none absolute inset-0 rounded-md ring-2 ring-white shadow-[0_0_0_3px_rgb(0_0_0/0.25)]"
                  aria-hidden="true"
                >
                  <template v-if="panning">
                    <span class="absolute inset-y-0 left-1/3 w-px bg-white/60" />
                    <span class="absolute inset-y-0 left-2/3 w-px bg-white/60" />
                    <span class="absolute inset-x-0 top-1/3 h-px bg-white/60" />
                    <span class="absolute inset-x-0 top-2/3 h-px bg-white/60" />
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- The tools, in groups: zoom, turn, start again. -->
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <UButton
                icon="i-lucide-minus"
                aria-label="Zoom out"
                color="neutral"
                variant="outline"
                :disabled="zoom <= zoomMin"
                @click="zoom -= 0.1"
              />
              <USlider
                v-model="zoom"
                :min="zoomMin"
                :max="MAX_ZOOM"
                :step="0.01"
                aria-label="Zoom"
                class="min-w-0 flex-1"
              />
              <UButton
                icon="i-lucide-plus"
                aria-label="Zoom in"
                color="neutral"
                variant="outline"
                :disabled="zoom >= MAX_ZOOM"
                @click="zoom += 0.1"
              />
            </div>
            <USeparator
              orientation="vertical"
              class="h-6"
            />
            <div class="flex gap-1">
              <UTooltip text="Rotate left">
                <UButton
                  icon="i-lucide-rotate-ccw"
                  aria-label="Rotate left"
                  color="neutral"
                  variant="outline"
                  :disabled="turning !== 0"
                  @click="rotate(-1)"
                />
              </UTooltip>
              <UTooltip text="Rotate right">
                <UButton
                  icon="i-lucide-rotate-cw"
                  aria-label="Rotate right"
                  color="neutral"
                  variant="outline"
                  :disabled="turning !== 0"
                  @click="rotate(1)"
                />
              </UTooltip>
            </div>
            <USeparator
              orientation="vertical"
              class="h-6"
            />
            <UButton
              :label="isCompact ? undefined : 'Reset'"
              aria-label="Reset"
              icon="i-lucide-undo-2"
              color="neutral"
              variant="outline"
              :disabled="!framedByHand"
              @click="reset"
            />
          </div>
          <p class="text-xs text-muted max-sm:hidden">
            Drag the photo to move it; zoom with the slider or the mouse wheel.
          </p>

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

        <!-- How customers will see it: side by side on phones, so both show under the tools. -->
        <section
          class="min-w-0 space-y-3 lg:border-l lg:border-default lg:pl-6"
          aria-labelledby="photo-previews-title"
        >
          <div>
            <h3
              id="photo-previews-title"
              class="flex min-h-8 items-center font-semibold text-highlighted"
            >
              How customers see it
            </h3>
            <p class="text-sm text-muted max-sm:hidden">
              The item page follows the menu card until you frame it.
            </p>
          </div>
          <div class="grid grid-cols-2 items-start gap-3 lg:grid-cols-1 lg:gap-4">
            <UCard
              v-for="item in VIEWS"
              :key="item.name"
              :data-testid="`photo-preview-${item.name}`"
              :class="view === item.name && 'ring-2 ring-primary'"
              :ui="{ header: 'flex items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-2.5', body: 'p-0 sm:p-0' }"
            >
              <template #header>
                <p class="min-w-0 truncate text-sm font-medium text-highlighted">
                  {{ item.label }}<span class="font-normal text-muted max-sm:hidden"> · {{ item.shape }}</span>
                </p>
                <UBadge
                  v-if="view === item.name"
                  label="Editing"
                  color="primary"
                  variant="soft"
                  icon="i-lucide-circle-dot"
                  size="sm"
                  class="shrink-0"
                />
                <UButton
                  v-else
                  :label="isCompact ? 'Edit' : 'Edit crop'"
                  :aria-label="`Frame the ${item.label.toLowerCase()}`"
                  trailing-icon="i-lucide-chevron-right"
                  color="neutral"
                  variant="outline"
                  size="xs"
                  class="shrink-0"
                  @click="view = item.name"
                />
              </template>
              <!-- The picture frames its view too, by pointer (the header's button by keyboard). -->
              <div
                class="cursor-pointer"
                @click="view = item.name"
              >
                <!-- The menu card as on the menu: the square beside the name. -->
                <div
                  v-if="item.name === 'card'"
                  class="flex items-center gap-3 p-3"
                >
                  <div
                    class="relative size-14 shrink-0 overflow-hidden rounded-md sm:size-20"
                    :style="{ backgroundColor: edit.fill }"
                  >
                    <img
                      :src="imageUrl"
                      alt=""
                      class="absolute max-w-none"
                      :style="photoStyle('card')"
                    >
                  </div>
                  <div class="min-w-0 space-y-0.5">
                    <p class="truncate text-sm font-medium text-highlighted sm:text-base">
                      {{ name || 'Menu item' }}
                    </p>
                    <p class="text-xs text-muted sm:text-sm">
                      Add to order
                    </p>
                  </div>
                </div>
                <!-- The item page's photo, 4:3 over its name. -->
                <template v-else>
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
                  <p class="truncate px-3 pt-2 text-sm font-medium text-highlighted">
                    {{ name || 'Menu item' }}
                  </p>
                </template>
                <p
                  class="px-3 pb-3 text-xs text-muted"
                  :class="item.name === 'card' ? 'max-sm:hidden' : 'pt-0.5'"
                >
                  {{ captionOf(item.name).lead }}<span class="max-sm:hidden">{{ captionOf(item.name).where }}</span>
                </p>
              </div>
            </UCard>
          </div>
        </section>
      </div>
    </template>

    <template #footer>
      <UButton
        v-if="phase === 'edit'"
        :label="isCompact ? 'Another photo' : 'Choose another photo'"
        icon="i-lucide-image"
        color="neutral"
        variant="outline"
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
