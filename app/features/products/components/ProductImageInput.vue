<script setup lang="ts">
/**
 * Menu item image: preview + Upload/Replace/Remove. The file is checked (type, size) and uploaded
 * as soon as it's picked; the form then holds the upload's `url` and asset `id`. Remove clears
 * both: the item is saved without an image (`imageId: null`).
 */
import { useFileDialog } from '@vueuse/core'
import { IMAGE_MAX_BYTES, IMAGE_TYPES, useItemMutations } from '../composables/useItems'

const props = defineProps<{ disabled?: boolean }>()

const imageUrl = defineModel<string | undefined>('imageUrl')
const imageId = defineModel<string | undefined>('imageId')
/** True while an upload runs, so the form can wait before saving. */
const uploading = defineModel<boolean>('uploading', { default: false })

const { uploadImage } = useItemMutations()
const formKey = useId()
watchEffect(() => {
  uploading.value = uploadImage.isPending(formKey)
})

const problem = ref<string>()
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
  if (file.size > IMAGE_MAX_BYTES) {
    problem.value = `The image is larger than ${maxMb} MB.`
    return
  }
  const result = await uploadImage.execute({ file, form: formKey })
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
      alt="Menu item image"
      class="size-20 rounded-md text-2xl"
    />
    <div class="space-y-1">
      <div class="flex gap-2">
        <UButton
          :label="imageUrl ? 'Replace image' : 'Upload image'"
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
        {{ uploading ? 'Uploading…' : `JPEG, PNG or WebP, up to ${maxMb} MB.` }}
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
