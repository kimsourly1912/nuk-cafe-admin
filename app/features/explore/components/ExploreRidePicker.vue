<script setup lang="ts">
import type { ExploreWorld } from '../runtime/world'

const { stops } = defineProps<{ stops: ExploreWorld['rideStops'] }>()
const emit = defineEmits<{ confirm: [id: string] }>()
const open = defineModel<boolean>('open', { required: true })
const selected = ref<string>()
const items = computed(() => stops.map(stop => ({
  value: stop.id,
  label: stop.label,
  description: `About ${stop.seconds} s in Explore`,
})))

watch(open, (visible) => {
  if (visible) selected.value = stops[0]?.id
})

function confirm() {
  if (selected.value) emit('confirm', selected.value)
}
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Where to?"
    description="Choose a drop-off on this demo street."
  >
    <template #body>
      <URadioGroup
        v-model="selected"
        legend="Drop-off"
        :items="items"
        variant="card"
      />
    </template>
    <template #footer>
      <UButton
        label="Back"
        color="neutral"
        variant="outline"
        @click="open = false"
      />
      <UButton
        label="Confirm destination"
        :disabled="!selected"
        @click="confirm"
      />
    </template>
  </AppModal>
</template>
