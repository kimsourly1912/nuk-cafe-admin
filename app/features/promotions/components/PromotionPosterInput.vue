<script setup lang="ts">
/**
 * The promotion's poster (M1, D163): an image designed elsewhere (Canva, an AI tool) and uploaded
 * finished. Shown portrait (4:5) as customers see it on the menu. A 4:5 design is uploaded as it
 * is, so its text stays sharp; only a file over the server's 5 MB is made smaller first (D122).
 * Any other shape (a square, a landscape) opens the crop modal (D180): the owner frames it 4:5 at
 * a high quality, or keeps it whole. The form holds the upload's `url` (the preview) and asset
 * `id` (what's saved).
 */
import { useClipboard, useFileDialog } from '@vueuse/core'
import { IMAGE_MAX_BYTES, IMAGE_TYPES } from '#shared/contracts/media'
import ImageCropModal from '~/components/ImageCropModal.vue'

const props = defineProps<{ disabled?: boolean }>()

const posterUrl = defineModel<string | undefined>('posterUrl')
const posterId = defineModel<string | undefined>('posterId')
/** True while the poster is prepared or uploaded, so the form can wait before saving. */
const uploading = defineModel<boolean>('uploading', { default: false })

const upload = useImageUpload()
const formKey = useId()
const problem = ref<string>()
const preparing = ref(false)
watchEffect(() => {
  const pending = upload.isPending(formKey)
  uploading.value = preparing.value || pending
})

/** The menu shows the poster 4:5. */
const POSTER_RATIO = 4 / 5
/** Twice the 1080 × 1350 a design usually is, and a high quality: a cropped design keeps its text sharp. */
const POSTER_MAX_EDGE = 2700
const POSTER_QUALITY = 0.92

// A new instance each time: one closed with `destroyOnClose` can't be opened again.
const overlay = useOverlay()

/** The poster framed 4:5, or `file` itself when kept whole; `null` when closed without either. */
function frame(file: File) {
  return overlay.create(ImageCropModal, { destroyOnClose: true })
    .open({
      file,
      aspectRatio: POSTER_RATIO,
      title: 'Frame the poster',
      description: 'The menu shows the poster portrait (4:5). Choose what stays in, or keep the whole poster.',
      maxEdge: POSTER_MAX_EDGE,
      quality: POSTER_QUALITY,
      keepLabel: 'Keep whole poster',
    })
    .result
}

/** A starting prompt for an AI image tool; the owner fills the [brackets] before sending it. */
const AI_PROMPT = [
  'Design a promotional poster for a cafe, portrait 4:5 (1080 × 1350 px).',
  'Promotion: [what is offered, e.g. "Buy 1 get 1 free on iced lattes"].',
  'Headline text: "[short headline]". Small text: "[dates or conditions]".',
  'Style: [warm, modern, playful…], using [brand colors].',
  'If I attach images: use my logo as is (do not redraw or change it) and place it small near the top or bottom, and build the poster around my product photo(s), keeping them recognisable. Delete this line if I attach nothing.',
  'Keep the key text large and inside the centre, with a safe margin on every edge. No logos of other brands.',
].join('\n')
const { copy, copied } = useClipboard({ copiedDuring: 2000, legacy: true })

const { open, onChange } = useFileDialog({ accept: IMAGE_TYPES.join(','), multiple: false, reset: true })

onChange(async (files) => {
  const file = files?.[0]
  if (!file) return
  problem.value = undefined
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    problem.value = 'Use a JPEG, PNG or WebP image.'
    return
  }
  if (file.size > IMAGE_MAX_ORIGINAL_BYTES) {
    problem.value = `The image is larger than ${IMAGE_MAX_ORIGINAL_BYTES / 1024 / 1024} MB.`
    return
  }
  let chosen = file
  // A design that isn't portrait (a square 1080 × 1080 is fine) is cut to 4:5 on the menu: the
  // owner frames it, or keeps it whole. A 4:5 design, or one the browser can't read, goes as it is.
  const size = await uprightSize(file)
  if (size && !isNearRatio(size, POSTER_RATIO)) {
    const framed = await frame(file)
    if (!framed) return
    chosen = framed
  }
  if (chosen.size > IMAGE_MAX_BYTES) {
    preparing.value = true
    chosen = await shrinkImage(chosen).finally(() => {
      preparing.value = false
    })
    if (chosen.size > IMAGE_MAX_BYTES) {
      problem.value = `The image is larger than ${IMAGE_MAX_BYTES / 1024 / 1024} MB. Export it smaller and try again.`
      return
    }
  }
  const result = await upload.execute({ file: chosen, input: formKey })
  if (!result.ok) return
  posterUrl.value = result.data.url
  posterId.value = result.data.id
})

function remove() {
  posterUrl.value = undefined
  posterId.value = undefined
}
</script>

<template>
  <div class="flex flex-col gap-4 sm:flex-row sm:items-start">
    <div class="relative aspect-4/5 w-36 shrink-0 overflow-hidden rounded-lg bg-elevated ring ring-default sm:w-40">
      <img
        v-if="posterUrl"
        :src="posterUrl"
        alt="Promotion poster"
        class="size-full object-cover"
      >
      <div
        v-else
        class="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-dimmed"
      >
        <UIcon
          name="i-lucide-image"
          class="size-8"
        />
        <span class="text-xs">No poster yet</span>
      </div>
      <div
        v-if="uploading"
        class="absolute inset-0 flex items-center justify-center bg-default/70"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-6 animate-spin text-muted"
          aria-label="Uploading the poster"
        />
      </div>
    </div>
    <div class="min-w-0 space-y-3">
      <p class="text-sm text-muted">
        Design it in Canva or with an AI tool, then upload the finished image. Square (1080 × 1080) or portrait (1080 × 1350) works best; JPEG, PNG or WebP.
      </p>
      <div class="flex flex-wrap gap-2">
        <UButton
          :label="posterUrl ? 'Replace poster' : 'Upload poster'"
          icon="i-lucide-upload"
          color="neutral"
          variant="outline"
          :loading="uploading"
          :disabled="props.disabled || uploading"
          @click="open()"
        />
        <UButton
          v-if="posterUrl"
          label="Remove"
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          :disabled="props.disabled || uploading"
          @click="remove"
        />
      </div>
      <p
        v-if="problem"
        class="text-sm text-error"
      >
        {{ problem }}
      </p>
      <div class="space-y-2 border-t border-default pt-3">
        <p class="text-sm text-muted">
          Not sure how to start? Copy this prompt, paste it into an AI tool such as ChatGPT or Gemini, and fill in the [brackets]. To use your own logo or product photos, attach them in the AI tool too.
        </p>
        <UButton
          :label="copied ? 'Copied' : 'Copy AI prompt'"
          :icon="copied ? 'i-lucide-check' : 'i-lucide-sparkles'"
          color="neutral"
          variant="soft"
          size="sm"
          :disabled="props.disabled"
          @click="copy(AI_PROMPT)"
        />
      </div>
    </div>
  </div>
</template>
