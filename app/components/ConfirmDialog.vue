<script setup lang="ts">
/**
 * Generic confirmation modal. Open it with `useConfirm()` rather than mounting it directly.
 * Only its buttons answer it; Back is Cancel, as on a phone's own dialogs (D201).
 */
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
  <AppModal
    :title="title"
    :description="description"
    :close="false"
    :dismissible="false"
    @back="emit('close', false)"
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
  </AppModal>
</template>
