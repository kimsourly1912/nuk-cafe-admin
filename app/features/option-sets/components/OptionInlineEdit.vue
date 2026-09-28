<script setup lang="ts">
/**
 * An inline text edit in the option-set editor (D73): an input with Save and Cancel. Enter saves,
 * Escape cancels only this edit: its `preventDefault` keeps the slide-over (or modal) open.
 * The input takes focus when it appears.
 *
 * @example
 * <OptionInlineEdit v-model="draft" label="New value" save-label="Add" :error="error" :saving="busy" @save="add" @cancel="stop" />
 */
const props = defineProps<{
  /** The input's accessible name. */
  label: string
  saveLabel?: string
  placeholder?: string
  error?: string
  saving?: boolean
}>()

const emit = defineEmits<{ save: [], cancel: [] }>()
const draft = defineModel<string>({ required: true })

const input = useTemplateRef<{ inputRef?: HTMLInputElement }>('input')
onMounted(() => {
  const el = input.value?.inputRef
  el?.focus()
  el?.select()
})
// The input is disabled while saving, which drops its focus; an edit that stays open (Add value,
// or a refused save) takes it back.
watch(() => props.saving, async (saving, was) => {
  if (saving || !was) return
  await nextTick()
  input.value?.inputRef?.focus()
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    if (!props.saving) emit('save')
  }
  else if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
  }
}
</script>

<template>
  <UFormField
    :error="error"
    class="w-full"
  >
    <div
      class="flex flex-wrap items-center gap-2"
      data-inline-edit
    >
      <UInput
        ref="input"
        v-model="draft"
        :aria-label="label"
        :placeholder="placeholder"
        :disabled="saving"
        class="min-w-40 flex-1"
        @keydown="onKeydown"
      />
      <div class="flex gap-2">
        <UButton
          :label="saveLabel ?? 'Save'"
          :loading="saving"
          :disabled="!!error"
          @click="emit('save')"
        />
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          :disabled="saving"
          @click="emit('cancel')"
        />
      </div>
    </div>
  </UFormField>
</template>
