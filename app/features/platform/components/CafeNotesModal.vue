<script setup lang="ts">
/**
 * The platform team's internal notes about a cafe (step P2, D189): a contact person, their phone
 * and free text. Never shown to the cafe. Saved at the notes' own version (409 when another super
 * admin saved first).
 */
import type { TenantDetail } from '#shared/contracts/tenants'
import { NOTES_CONTACT_MAX, NOTES_TEXT_MAX } from '#shared/contracts/tenants'
import { useCafeMutations } from '../composables/useCafes'
import type { NotesForm } from '../schemas/owner-form'
import { notesFormSchema, toNotesBody, toNotesForm } from '../schemas/owner-form'

const props = defineProps<{ cafe: TenantDetail }>()
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const initial = toNotesForm(props.cafe.notes)
const state = reactive<NotesForm>(structuredClone(initial))
const form = useTemplateRef('form')
useFormErrorRecheck(form)
const { updateNotes } = useCafeMutations()
const saving = ref(false)
const unsaved = useModalUnsavedChanges(state, { initial, paused: saving, close: () => emit('close', false) })

async function onSubmit() {
  if (saving.value) return
  saving.value = true
  const result = await updateNotes.execute({ cafe: props.cafe, body: toNotesBody(state, props.cafe.notes.version) })
  saving.value = false
  if (!result.ok) {
    if (result.status === 'error') {
      form.value?.setErrors(Object.entries(result.error.fieldErrors ?? {})
        .flatMap(([name, messages]) => (messages[0] ? [{ name, message: messages[0] }] : [])))
    }
    return
  }
  unsaved.markClean()
  emit('close', true)
}
</script>

<template>
  <UModal
    title="Internal notes"
    :description="`For the platform team about ${cafe.name}: never shown to the cafe.`"
    @update:open="unsaved.onOpenChange"
  >
    <template #body>
      <UForm
        id="notes-form"
        ref="form"
        :schema="notesFormSchema"
        :state="state"
        :disabled="saving"
        class="space-y-4"
        @submit="onSubmit"
        @error="focusFirstInvalid"
      >
        <UFormField
          label="Contact person"
          name="contactName"
        >
          <UInput
            v-model="state.contactName"
            :maxlength="NOTES_CONTACT_MAX"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Phone"
          name="contactPhone"
        >
          <PhoneInput
            v-model="state.contactPhone"
            v-model:country="state.contactPhoneCountry"
          />
        </UFormField>
        <UFormField
          label="Notes"
          name="notes"
        >
          <UTextarea
            v-model="state.notes"
            :maxlength="NOTES_TEXT_MAX"
            :rows="4"
            autoresize
            class="w-full"
          />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          :disabled="saving"
          @click="unsaved.requestClose()"
        />
        <UButton
          type="submit"
          form="notes-form"
          label="Save notes"
          :loading="saving"
        />
      </div>
    </template>
  </UModal>
</template>
