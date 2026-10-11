<script setup lang="ts">
/**
 * The promotion's poster (M1, D163): an image designed elsewhere (Canva, an AI tool) and uploaded
 * finished. Shown portrait (4:5) as customers see it on the menu. Uploaded as it is, so its text
 * stays sharp; only a file over the server's 5 MB is made smaller first (D122). The form holds the
 * upload's `url` (the preview) and asset `id` (what's saved).
 */
import { useFileDialog } from '@vueuse/core'
import { IMAGE_MAX_BYTES, IMAGE_TYPES } from '#shared/contracts/media'

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
  if (file.size > IMAGE_MAX_BYTES) {
    preparing.value = true
    chosen = await shrinkImage(file).finally(() => {
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
    <div class="relative aspect-[4/5] w-36 shrink-0 overflow-hidden rounded-lg bg-elevated ring ring-default sm:w-40">
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
    </div>
  </div>
</template>
