<script setup lang="ts">
/**
 * A menu item's photo in its form (D158): the photo as the menu card shows it, with **Add photo**
 * or **Edit photo** (the photo editor, `PhotoEditorModal`) and **Remove**. The form holds the
 * photo's `imageId` and its card `imageUrl`; nothing is published until the item is saved.
 */
import type { MenuImage } from '#shared/contracts/media'
import PhotoEditorModal from './PhotoEditorModal.vue'

const props = defineProps<{
  /** The item's name, for the editor's previews. */
  name?: string
  disabled?: boolean
}>()

const imageUrl = defineModel<string | undefined>('imageUrl')
const imageId = defineModel<string | undefined>('imageId')
/** The photo the editor just made, for its blurred placeholder in the preview. */
const image = ref<MenuImage | null>(null)
watch(imageId, () => {
  if (image.value && imageUrl.value !== image.value.card) image.value = null
})

const overlay = useOverlay()
const editor = overlay.create(PhotoEditorModal, { destroyOnClose: true })

async function openEditor(edit: boolean) {
  const photo = await editor.open({ name: props.name, photoId: edit ? imageId.value : undefined }).result
  if (!photo) return
  image.value = photo.image
  imageUrl.value = photo.image.card
  imageId.value = photo.id
}

function remove() {
  imageUrl.value = undefined
  imageId.value = undefined
  image.value = null
}
</script>

<template>
  <div class="flex items-center gap-4">
    <MenuItemImage
      :image="image"
      :src="imageUrl"
      usage="card"
      icon="i-lucide-image"
      alt="Menu item photo"
      class="size-20 rounded-md"
    />
    <div class="space-y-1">
      <div class="flex flex-wrap gap-2">
        <UButton
          :label="imageId ? 'Edit photo' : 'Add photo'"
          :icon="imageId ? 'i-lucide-crop' : 'i-lucide-image-plus'"
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="disabled"
          @click="openEditor(Boolean(imageId))"
        />
        <UButton
          v-if="imageId"
          label="Remove"
          icon="i-lucide-trash-2"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="disabled"
          @click="remove"
        />
      </div>
      <p class="text-xs text-muted">
        {{ imageId ? 'Shown square on the menu and 4:3 on the item\'s page.' : 'Crop it for the menu and the item\'s page, and see it as customers will.' }}
      </p>
    </div>
  </div>
</template>
