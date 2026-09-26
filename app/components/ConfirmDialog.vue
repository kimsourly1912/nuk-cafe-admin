<script setup lang="ts">
/** Generic confirmation modal. Open it with `useConfirm()` rather than mounting it directly. */
withDefaults(defineProps<{
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}>(), {
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
})

const emit = defineEmits<{ close: [confirmed: boolean] }>()
</script>

<template>
  <UModal
    :title="title"
    :description="description"
    :close="false"
    :dismissible="false"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          :label="cancelLabel"
          color="neutral"
          variant="outline"
          @click="emit('close', false)"
        />
        <UButton
          :label="confirmLabel"
          :color="danger ? 'error' : 'primary'"
          @click="emit('close', true)"
        />
      </div>
    </template>
  </UModal>
</template>
