<script setup lang="ts">
/**
 * Open a cafe its owner allowed support for (P5, D193): a fresh 6-digit code from the super admin's
 * authenticator app (a backup code doesn't open it), then a full page load into the cafe's admin,
 * read-only, for up to an hour. Wrong codes are counted: five in 15 minutes and opening waits.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { TenantDetail } from '#shared/contracts/tenants'
import { openSupportSchema } from '#shared/contracts/support'
import { useCafeMutations } from '../composables/useCafes'

const props = defineProps<{ cafe: TenantDetail }>()
const emit = defineEmits<{ close: [] }>()

const state = reactive({ code: '' })
const form = useTemplateRef('form')
useFormErrorRecheck(form)
const { openSupport } = useCafeMutations()
const saving = ref(false)

async function onSubmit({ data }: FormSubmitEvent<{ code: string }>) {
  if (saving.value) return
  saving.value = true
  const result = await openSupport.execute({ cafe: props.cafe, body: data })
  if (result.ok) {
    // Another workspace: a full page load, as when changing cafes.
    window.location.assign(result.data.path)
    return
  }
  saving.value = false
  if (result.status === 'error') {
    form.value?.setErrors(Object.entries(result.error.fieldErrors ?? {})
      .flatMap(([name, messages]) => (messages[0] ? [{ name, message: messages[0] }] : [])))
  }
}
</script>

<template>
  <AppModal
    :title="`Open ${cafe.name} as support`"
    description="Read-only: you'll see its admin as the owner does, but nothing can be changed. Every page you open is recorded in the cafe's history."
  >
    <template #body>
      <UForm
        id="support-open-form"
        ref="form"
        :schema="openSupportSchema"
        :state="state"
        :disabled="saving"
        :validate-on="['blur', 'change']"
        @submit="onSubmit"
        @error="focusFirstInvalid"
      >
        <UFormField
          label="Code from your authenticator app"
          name="code"
          help="A fresh 6-digit code: this checks it's really you."
          required
        >
          <UInput
            v-model="state.code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            autofocus
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
          @click="emit('close')"
        />
        <UButton
          type="submit"
          form="support-open-form"
          label="Open read-only"
          :loading="saving"
        />
      </div>
    </template>
  </AppModal>
</template>
