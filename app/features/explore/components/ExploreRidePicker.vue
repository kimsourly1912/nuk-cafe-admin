<script setup lang="ts">
import type { RideStopOption } from '../runtime/world'

const { stops } = defineProps<{ stops: readonly RideStopOption[] }>()
const emit = defineEmits<{ confirm: [id: string] }>()
const open = defineModel<boolean>('open', { required: true })
const selected = ref<string>()
const networked = computed(() => stops.some(stop => stop.branchId))
const items = computed(() => stops.map(stop => ({
  value: stop.id,
  label: stop.label,
  description: stop.branchId ? `Another branch · about ${stop.seconds} s in Explore` : `On this street · about ${stop.seconds} s in Explore`,
})))

watch(open, (visible) => {
  if (visible) selected.value = (stops.find(stop => stop.branchId) ?? stops[0])?.id
})

function confirm() {
  if (selected.value) emit('confirm', selected.value)
}
</script>

<template>
  <AppModal
    v-model:open="open"
    title="Where to?"
    :description="networked ? 'Choose another branch, or a drop-off on this street.' : 'Choose a drop-off on this demo street.'"
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
