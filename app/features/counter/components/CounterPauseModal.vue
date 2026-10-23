<script setup lang="ts">
/**
 * Pause online orders (D199): for 15 minutes, 30 minutes, an hour or until closing (the server
 * never lets it run past closing), with an optional reason the counter sees. Orders already placed
 * carry on. Open via `useOverlay().create(CounterPauseModal)`; emits `close(true)` when paused. A
 * refused pause (the branch closed meanwhile) shows here with the choice kept. Full screen on phones.
 */
import type { PauseChoice } from '#shared/contracts/branches'
import { PAUSE_REASON_MAX } from '#shared/contracts/branches'
import { useBranchPause } from '../composables/useBranchPause'

const props = defineProps<{ branchId: string }>()
const emit = defineEmits<{ 'close': [paused: boolean], 'update:open': [open: boolean] }>()

const CHOICES: { value: PauseChoice, label: string }[] = [
  { value: '15m', label: '15 minutes' },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: 'closing', label: 'Until closing' },
]

const state = reactive<{ choice: PauseChoice, reason: string }>({ choice: '15m', reason: '' })
const { isCompact: fullscreen } = useLayoutContext()
const { pause } = useBranchPause(() => props.branchId)
const saving = ref(false)
const unsaved = useModalUnsavedChanges(state, { paused: saving, close: () => emit('close', false) })
const lastError = ref<string>()

async function submit() {
  if (saving.value) return
  saving.value = true
  lastError.value = undefined
  const result = await pause.execute({ for: state.choice, reason: state.reason.trim() || null })
  saving.value = false
  if (result.ok) {
    unsaved.markClean()
    emit('close', true)
  }
  else if (result.status === 'error') lastError.value = result.error.message
}

useSubmitShortcut(submit)
</script>

<template>
  <UModal
    title="Pause online orders"
    description="Customers can't order online until then. Orders already placed carry on, and ordering starts again by itself."
    :fullscreen="fullscreen"
    :ui="{ footer: 'pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <form
        id="pause-form"
        class="space-y-4"
        @submit.prevent="submit"
      >
        <UAlert
          v-if="lastError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Not paused"
          :description="lastError"
        />
        <UFormField label="How long">
          <URadioGroup
            v-model="state.choice"
            :items="CHOICES"
            variant="card"
            legend="How long"
            :ui="{ legend: 'sr-only', fieldset: 'grid grid-cols-2 gap-2' }"
            :disabled="saving"
          />
        </UFormField>
        <UFormField
          label="Reason"
          hint="Optional"
          help="Shown on the counter, not to customers."
        >
          <UInput
            v-model="state.reason"
            :maxlength="PAUSE_REASON_MAX"
            placeholder="For example: the coffee machine is broken"
            class="w-full"
            :disabled="saving"
          />
        </UFormField>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="unsaved.requestClose()"
        />
        <UButton
          type="submit"
          form="pause-form"
          label="Pause orders"
          color="warning"
          icon="i-lucide-pause"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
