<script setup lang="ts">
/**
 * Crops a picked photo to one shape, for any photo upload (a logo, a poster, an avatar): the photo
 * is dragged and zoomed inside a frame of the given proportions (the slider, the wheel, arrow
 * keys, + and −), the part left out dimmed around it; **Rotate** turns it a quarter; **Reset**
 * centres it again. **Use photo** makes the cropped file in the browser (WebP, at most `maxEdge`
 * px, never enlarged) and closes at once with it. Menu photos have their own two-view editor
 * (`PhotoEditorModal`, D158); the geometry and drawing are shared (`image-crop.ts`, `image-canvas.ts`).
 *
 * Opened with `useOverlay`, a new instance each time (`destroyOnClose`): the result is the cropped
 * file, or `null` when closed without one. `<ImageInput crop-ratio>` does this for its picked file.
 *
 * @example
 * const file = await overlay.create(ImageCropModal, { destroyOnClose: true })
 *   .open({ file, aspectRatio: 4 / 5, title: 'Crop the poster' }).result
 */
import type { CropView, Size } from '~/utils/image-crop'
import type { PhotoSource } from '~/utils/image-canvas'

const props = withDefaults(defineProps<{
  /** The photo to crop: already checked (type, size) by the picker. */
  file: File
  /** Width ÷ height of the frame (1 square, 4 / 5 portrait, 16 / 9 wide). */
  aspectRatio?: number
  title?: string
  description?: string
  /** The longest side of the cropped file, at most; never enlarged. */
  maxEdge?: number
  /** The encoder's quality, 0 to 1 (default as for every upload, D122). */
  quality?: number
  /** Adds a button with this label that closes with the picked `file` itself, uncropped: for designs that must stay whole. */
  keepLabel?: string
}>(), {
  aspectRatio: 1,
  title: 'Crop photo',
  description: 'Drag the photo to frame it, then use it.',
  maxEdge: IMAGE_MAX_EDGE,
  quality: IMAGE_QUALITY,
})
const emit = defineEmits<{ 'close': [file: File | null], 'update:open': [open: boolean] }>()

const { isCompact } = useLayoutContext()

type Phase = 'loading' | 'edit' | 'failed'
const phase = ref<Phase>('loading')
const source = shallowRef<PhotoSource | null>(null)
const imageUrl = ref<string | null>(null)
const view = ref<CropView>(newCrop())
const problem = ref<string>()
/** Making the file from the photo (a moment), after Use photo. */
const saving = ref(false)

const frame = computed<Size>(() => cropFrame(props.aspectRatio))
const boxStyle = computed(() => ({
  aspectRatio: String(props.aspectRatio),
  width: `min(100%, calc(min(${isCompact.value ? '30dvh' : '50dvh'}, 26rem) * ${props.aspectRatio}))`,
}))

onBeforeUnmount(() => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
})

/** Shows a photo; `url` when its display copy is already made (a turn). */
async function show(next: PhotoSource, url?: string) {
  const shown = url ?? await sourceUrl(next)
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = shown
  source.value = next
  view.value = newCrop()
  phase.value = 'edit'
}

onMounted(async () => {
  try {
    await show(await loadPhoto(props.file))
  }
  catch {
    problem.value = 'This photo can\'t be opened here. Save it as a JPEG or PNG, or choose another one.'
    phase.value = 'failed'
  }
})

// --- Turning the photo ---
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
    await show(next, url)
  }
  finally {
    turning.value = 0
  }
}

// --- Framing ---
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

function move(dx: number, dy: number) {
  if (!source.value) return
  view.value = moveCrop(source.value.size, frame.value, view.value, dx, dy)
}
const zoom = computed({
  get: () => view.value.zoom,
  set: (value: number) => {
    if (source.value) view.value = zoomCrop(source.value.size, frame.value, view.value, value)
  },
})
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
const moved = computed(() => view.value.zoom !== 1 || view.value.x !== 0.5 || view.value.y !== 0.5)
function reset() {
  view.value = newCrop()
}

/** Where the photo sits in the frame, as CSS. */
const photoStyle = computed(() => (source.value ? placementStyle(placePhoto(source.value.size, frame.value, view.value), frame.value) : {}))
const small = computed(() => source.value && Math.min(source.value.size.width, source.value.size.height) < Math.min(props.maxEdge, 600))

// --- Use photo ---
async function usePhoto() {
  if (!source.value || saving.value) return
  problem.value = undefined
  saving.value = true
  try {
    emit('close', await cropPhoto(source.value, props.aspectRatio, view.value, props.file.name, props.maxEdge, props.quality))
  }
  catch {
    problem.value = 'This browser couldn\'t prepare the photo. Try again, or choose another one.'
  }
  finally {
    saving.value = false
  }
}

function onOpenChange(open: boolean) {
  if (!open && !saving.value) emit('close', null)
}
</script>

<template>
  <AppModal
    :title="title"
    :description="description"
    :fullscreen="isCompact"
    :dismissible="!saving"
    :ui="{ content: 'sm:max-w-xl', footer: 'flex-wrap justify-end gap-2 pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    @update:open="onOpenChange"
  >
    <template #body>
      <div
        v-if="phase === 'loading'"
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

      <UAlert
        v-else-if="phase === 'failed'"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="problem"
      />

      <div
        v-else-if="source && imageUrl"
        class="space-y-3"
      >
        <!-- The frame, with the part of the photo left out dimmed around it. -->
        <div
          class="overflow-hidden rounded-lg border border-default bg-elevated/50 px-6 py-4 sm:px-10 sm:py-8"
          data-testid="crop-stage"
        >
          <div
            class="transition-transform ease-out motion-reduce:transition-none"
            :class="turning ? 'duration-200' : 'duration-0'"
            :style="{ transform: `rotate(${turning * 90}deg)` }"
          >
            <div
              ref="frame"
              class="relative mx-auto cursor-grab touch-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary active:cursor-grabbing"
              :style="boxStyle"
              role="group"
              tabindex="0"
              aria-label="Frame the photo: drag it, or use the arrow keys. Plus and minus zoom."
              :data-photo="`${source.size.width}x${source.size.height}`"
              data-testid="crop-frame"
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
                :style="photoStyle"
                draggable="false"
              >
              <div class="absolute inset-0 overflow-hidden rounded-md">
                <img
                  :src="imageUrl"
                  alt=""
                  class="absolute max-w-none select-none"
                  :style="photoStyle"
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
              :disabled="zoom <= 1"
              @click="zoom -= 0.1"
            />
            <USlider
              v-model="zoom"
              :min="1"
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
            :disabled="!moved"
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
          description="It may look blurry. A larger photo looks sharper."
        />
        <UAlert
          v-if="problem"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="problem"
        />
      </div>
    </template>

    <template #footer>
      <UButton
        v-if="keepLabel"
        :label="keepLabel"
        color="neutral"
        variant="ghost"
        class="me-auto"
        :disabled="saving"
        @click="emit('close', file)"
      />
      <UButton
        label="Cancel"
        color="neutral"
        variant="outline"
        :disabled="saving"
        @click="emit('close', null)"
      />
      <UButton
        label="Use photo"
        :loading="saving"
        :disabled="phase !== 'edit'"
        @click="usePhoto"
      />
    </template>
  </AppModal>
</template>
