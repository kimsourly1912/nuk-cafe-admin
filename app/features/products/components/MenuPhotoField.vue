<script setup lang="ts">
/**
 * A menu item's photo in its form (D158): the photo as the menu card shows it, with **Add photo**
 * or **Edit photo** (the photo editor, `PhotoEditorModal`) and **Remove**. The form holds the
 * photo's `imageId` and its card `imageUrl`; nothing is published until the item is saved.
 *
 * **Use photo** closes the editor at once and the upload runs here: the new photo shows on the
 * preview, dimmed with a spinner, and the form waits for it before saving (`uploading`). **Edit
 * photo** meanwhile opens the same photo from memory, as it was left; using it again replaces the
 * upload (the earlier one's answer is ignored, and its files are cleaned up after 24 hours). A
 * failed upload says so on the preview with **Try again**, or **Cancel** to keep the photo it had.
 */
import type { MenuImage } from '#shared/contracts/media'
import { usePhotoUpload } from '../composables/usePhotos'
import type { PreparedPhoto } from '../utils/photo-canvas'
import PhotoEditorModal from './PhotoEditorModal.vue'

const props = defineProps<{
  /** The item's name, for the editor's previews. */
  name?: string
  disabled?: boolean
}>()

const imageUrl = defineModel<string | undefined>('imageUrl')
const imageId = defineModel<string | undefined>('imageId')
/** True while a photo uploads: the form waits for it before saving. */
const uploading = defineModel<boolean>('uploading', { default: false })

/** The photo the editor just made, for its blurred placeholder in the preview. */
const image = ref<MenuImage | null>(null)
watch(imageId, () => {
  if (image.value && imageUrl.value !== image.value.card) image.value = null
})

interface PendingPhoto {
  photo: PreparedPhoto
  status: 'uploading' | 'failed'
  /** Which upload this is: only the latest one's answer is used. */
  attempt: number
}
const pending = shallowRef<PendingPhoto | null>(null)
watchEffect(() => {
  uploading.value = pending.value?.status === 'uploading'
})

const upload = usePhotoUpload()
const fieldKey = useId()
let attempts = 0

function forget(photo: PreparedPhoto | undefined) {
  if (photo) URL.revokeObjectURL(photo.cardUrl)
}
onBeforeUnmount(() => forget(pending.value?.photo))

async function start(photo: PreparedPhoto) {
  if (pending.value && pending.value.photo !== photo) forget(pending.value.photo)
  const attempt = ++attempts
  pending.value = { photo, status: 'uploading', attempt }
  const result = await upload.execute({ body: photo.body, editor: `${fieldKey}:${attempt}` })
  // Replaced, removed or cancelled meanwhile: this answer is no longer wanted.
  if (pending.value?.attempt !== attempt) return
  if (!result.ok) {
    pending.value = { photo, status: 'failed', attempt }
    return
  }
  image.value = result.data.image
  imageUrl.value = result.data.image.card
  imageId.value = result.data.id
  pending.value = null
  forget(photo)
}

// A new instance each time: one closed with `destroyOnClose` can't be opened again.
const overlay = useOverlay()

async function openEditor() {
  const current = pending.value?.photo
  const photo = await overlay.create(PhotoEditorModal, { destroyOnClose: true })
    .open({ name: props.name, photoId: current ? undefined : imageId.value, photo: current })
    .result
  if (photo) void start(photo)
}

function cancelUpload() {
  forget(pending.value?.photo)
  pending.value = null
}

function remove() {
  cancelUpload()
  imageUrl.value = undefined
  imageId.value = undefined
  image.value = null
}
</script>

<template>
  <div class="flex items-center gap-4">
    <div class="relative shrink-0">
      <MenuItemImage
        :image="pending ? null : image"
        :src="pending ? pending.photo.cardUrl : imageUrl"
        usage="card"
        icon="i-lucide-image"
        alt="Menu item photo"
        class="size-20 rounded-md"
        :class="pending && 'opacity-60'"
      />
      <div
        v-if="pending"
        class="absolute inset-0 flex items-center justify-center rounded-md"
        :class="pending.status === 'failed' ? 'bg-error/15' : 'bg-default/30'"
        data-testid="photo-upload-state"
      >
        <UIcon
          :name="pending.status === 'failed' ? 'i-lucide-circle-alert' : 'i-lucide-loader-circle'"
          class="size-6"
          :class="pending.status === 'failed' ? 'text-error' : 'animate-spin text-highlighted'"
        />
      </div>
    </div>
    <div class="min-w-0 space-y-1">
      <div class="flex flex-wrap gap-2">
        <UButton
          :label="imageId || pending ? 'Edit photo' : 'Add photo'"
          :icon="imageId || pending ? 'i-lucide-crop' : 'i-lucide-image-plus'"
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="disabled"
          @click="openEditor"
        />
        <UButton
          v-if="pending?.status === 'failed'"
          label="Try again"
          icon="i-lucide-rotate-cw"
          size="sm"
          :disabled="disabled"
          @click="start(pending.photo)"
        />
        <UButton
          v-if="pending?.status === 'failed'"
          label="Cancel"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="disabled"
          @click="cancelUpload"
        />
        <UButton
          v-else-if="imageId || pending"
          label="Remove"
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="disabled"
          @click="remove"
        />
      </div>
      <p
        class="text-xs"
        :class="pending?.status === 'failed' ? 'text-error' : 'text-muted'"
        aria-live="polite"
      >
        <template v-if="pending?.status === 'uploading'">
          Uploading the photo… You can keep editing.
        </template>
        <template v-else-if="pending?.status === 'failed'">
          The photo didn't upload. Try again, or Cancel to keep {{ imageId ? 'the photo it had' : 'no photo' }}.
        </template>
        <template v-else>
          {{ imageId ? 'Shown square on the menu and 4:3 on the item\'s page.' : 'Crop it for the menu and the item\'s page, and see it as customers will.' }}
        </template>
      </p>
    </div>
  </div>
</template>
