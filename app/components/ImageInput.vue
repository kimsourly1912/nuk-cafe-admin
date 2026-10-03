<script setup lang="ts">
/**
 * An image for a record (a menu item's photo, the cafe's logo, D143): preview + Upload/Replace/
 * Remove. The file is checked (type), made smaller in the browser (at most 1600 px, WebP, D122),
 * checked for size, and uploaded as soon as it's picked; the form then holds the upload's `url` and
 * asset `id`. Remove clears both: the record is saved without an image (`null`).
 *
 * @example
 * <ImageInput v-model:image-url="state.imageUrl" v-model:image-id="state.imageId" v-model:uploading="uploading" alt="Menu item image" />
 */
import { useFileDialog } from '@vueuse/core'
import { IMAGE_MAX_BYTES, IMAGE_TYPES } from '#shared/contracts/media'

const props = withDefaults(defineProps<{
  /** The preview's text alternative: what the image is ("Menu item image", "Cafe logo"). */
  alt: string
  disabled?: boolean
  /** The word on the buttons: "Upload image", "Replace logo". */
  noun?: string
}>(), { noun: 'image' })

const imageUrl = defineModel<string | undefined>('imageUrl')
const imageId = defineModel<string | undefined>('imageId')
/** True while an upload runs, so the form can wait before saving. */
const uploading = defineModel<boolean>('uploading', { default: false })

const uploadImage = useImageUpload()
const formKey = useId()
const problem = ref<string>()
/** Making the photo smaller (a moment for a big phone photo), before the upload starts. */
const preparing = ref(false)
// Runs at once, during setup: declared after `preparing`, which it reads.
watchEffect(() => {
  // Both read every time, so the effect always tracks both.
  const pending = uploadImage.isPending(formKey)
  uploading.value = preparing.value || pending
})
const maxMb = IMAGE_MAX_BYTES / 1024 / 1024

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
  preparing.value = true
  const upload = await shrinkImage(file).finally(() => {
    preparing.value = false
  })
  if (upload.size > IMAGE_MAX_BYTES) {
    problem.value = `The image is still larger than ${maxMb} MB after making it smaller. Try another photo.`
    return
  }
  const result = await uploadImage.execute({ file: upload, input: formKey })
  if (!result.ok) return
  imageUrl.value = result.data.url
  imageId.value = result.data.id
})

function removeImage() {
  imageUrl.value = undefined
  imageId.value = undefined
}
</script>

<template>
  <div class="flex items-center gap-4">
    <UAvatar
      :src="imageUrl"
      icon="i-lucide-image"
      :alt="alt"
      class="size-20 rounded-md text-2xl"
    />
    <div class="space-y-1">
      <div class="flex gap-2">
        <UButton
          :label="imageUrl ? `Replace ${noun}` : `Upload ${noun}`"
          icon="i-lucide-upload"
          color="neutral"
          variant="outline"
          size="sm"
          :loading="uploading"
          :disabled="props.disabled || uploading"
          @click="open()"
        />
        <UButton
          v-if="imageUrl"
          label="Remove"
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="props.disabled || uploading"
          @click="removeImage"
        />
      </div>
      <p class="text-xs text-muted">
        {{ preparing ? 'Preparing the photo…' : uploading ? 'Uploading…' : 'JPEG, PNG or WebP. Large photos are made smaller before upload.' }}
      </p>
      <p
        v-if="problem"
        class="text-xs text-error"
      >
        {{ problem }}
      </p>
    </div>
  </div>
</template>
