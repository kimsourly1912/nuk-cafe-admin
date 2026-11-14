<script setup lang="ts">
import type { LayoutScene, ShopLayout } from '#shared/contracts/shop-layout'
import { NO_SCENE, streetDoor } from '#shared/contracts/shop-layout'
import { wallNames } from '../designer/outline'

const props = defineProps<{ layout: ShopLayout, hasPin: boolean }>()
const emit = defineEmits<{ change: [scene: LayoutScene] }>()
const open = defineModel<boolean>('open', { required: true })

const scene = computed(() => props.layout.scene ?? NO_SCENE)
const none = '@none'
const doors = computed(() => {
  const ground = props.layout.floors[0]
  if (!ground) return []
  const names = wallNames(ground)
  return ground.walls.flatMap((wall, index) => (wall.openings ?? [])
    .filter(opening => opening.kind === 'door')
    .flatMap((door, position) => streetDoor(props.layout.floors, door.id)
      ? [{ label: `${names[index]} · Door ${position + 1}`, value: door.id }]
      : []))
})
const options = computed(() => [{ label: 'No street door', value: none }, ...doors.value])
const canPublish = computed(() => props.hasPin && Boolean(scene.value.entrance))

function chooseDoor(value: string) {
  if (value === none) emit('change', { ...scene.value, entrance: null, explore: false })
  else emit('change', { ...scene.value, entrance: value })
}
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Explore settings"
    description="These settings take effect when you save the shop layout."
  >
    <template #body>
      <div class="space-y-4">
        <UFormField
          label="Street door"
          help="The entrance to the café from the street."
        >
          <USelect
            :model-value="scene.entrance ?? none"
            :items="options"
            aria-label="Street door"
            :disabled="!doors.length"
            class="w-full"
            @update:model-value="chooseDoor"
          />
        </UFormField>
        <USwitch
          :model-value="Boolean(scene.explore)"
          :disabled="!scene.explore && !canPublish"
          label="Show in Explore"
          description="Let customers visit this saved layout."
          @update:model-value="value => emit('change', { ...scene, explore: value })"
        />
        <p
          v-if="!hasPin"
          class="text-sm text-muted"
        >
          Save a map pin in Branch settings before this layout can appear in Explore.
        </p>
        <p
          v-if="!doors.length"
          class="text-sm text-muted"
        >
          Add a door to the ground floor to choose a street entrance.
        </p>
      </div>
    </template>
    <template #footer>
      <UButton
        label="Done"
        @click="open = false"
      />
    </template>
  </AppModal>
</template>
