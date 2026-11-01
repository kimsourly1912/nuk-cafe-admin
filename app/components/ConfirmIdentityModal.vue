<script setup lang="ts">
/**
 * "Confirm it's you" (D246): asked by the API layer when a dangerous change (payment settings, admin
 * access, a cafe's owners) needs the password again. Opened with `useOverlay` by plugins/api.ts;
 * emits `close(true)` once this session is confirmed (for 15 minutes), `close()` otherwise. A wrong
 * password stays beside the field, the dialog open; any other refusal shows above it.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { IdentityConfirmed } from '#shared/contracts/account'
import { confirmIdentitySchema } from '#shared/contracts/account'
import type * as v from 'valibot'

const emit = defineEmits<{ 'close': [confirmed?: boolean], 'update:open': [open: boolean] }>()

const state = reactive({ password: '' })
const showPassword = ref(false)
const { isCompact: fullscreen } = useLayoutContext()

const form = useTemplateRef('form')
useFormErrorRecheck(form)
useSubmitShortcut(() => form.value?.submit())

const confirm = useMutation(
  (input: v.InferOutput<typeof confirmIdentitySchema>) => apiFetch<IdentityConfirmed>('/me/confirm', { method: 'POST', body: input }),
  // The change it was asked for reports its own success or failure.
  { id: 'account:confirm-identity', successMessage: false, errorMessage: 'Not confirmed' },
)
/** The last refusal that isn't about the password field. */
const lastError = ref<string>()

async function onSubmit({ data }: FormSubmitEvent<v.InferOutput<typeof confirmIdentitySchema>>) {
  lastError.value = undefined
  const result = await confirm.execute(data, { confirm: false })
  if (result.ok) {
    emit('close', true)
    return
  }
  if (result.status === 'error') {
    const field = result.error.fieldErrors?.password?.[0]
    if (field) form.value?.setErrors([{ name: 'password', message: field }])
    else if (result.error.kind !== 'aborted' && result.error.kind !== 'unauthorized') lastError.value = result.error.message
  }
}
</script>

<template>
  <AppModal
    title="Confirm it's you"
    description="Enter your password to make this change. You won't be asked again for 15 minutes."
    :fullscreen="fullscreen"
    :dismissible="!confirm.pending"
    :ui="{ footer: 'pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    @update:open="(open: boolean) => { if (!open) emit('close') }"
  >
    <template #body>
      <UForm
        id="confirm-identity-form"
        ref="form"
        :schema="confirmIdentitySchema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="confirm.pending"
        class="space-y-4"
        @submit="onSubmit"
        @error="focusFirstInvalid"
      >
        <UAlert
          v-if="lastError"
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Not confirmed"
          :description="lastError"
        />
        <UFormField
          label="Your password"
          name="password"
          required
        >
          <UInput
            id="confirm-identity-password"
            v-model="state.password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            autofocus
            class="w-full"
            :ui="{ trailing: 'pe-1' }"
          >
            <template #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="sm"
                :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                :aria-pressed="showPassword"
                aria-controls="confirm-identity-password"
                @click="showPassword = !showPassword"
              />
            </template>
          </UInput>
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          :disabled="confirm.pending"
          class="max-sm:flex-1 max-sm:justify-center"
          @click="emit('close')"
        />
        <UButton
          type="submit"
          form="confirm-identity-form"
          label="Confirm"
          :loading="confirm.pending"
          class="max-sm:flex-1 max-sm:justify-center"
        />
      </div>
    </template>
  </AppModal>
</template>
