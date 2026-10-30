<script setup lang="ts">
/**
 * "Delete your account?" (D237): what goes (sign-in everywhere, name, email and phone in every
 * cafe), what stays (the cafes' past orders, without the name), then the password. Open via
 * `useOverlay().create(DeleteAccountModal)`; emits `close(true)` once deleted, `close()` otherwise.
 * A refusal stays here (toasts are out of reach while it's open), the password kept for a retry.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import { deleteAccountSchema } from '#shared/contracts/account'
import type { DeleteAccountInput } from '#shared/contracts/account'
import { useDeleteAccount } from '../composables/useCustomerAccount'
import PasswordInput from './PasswordInput.vue'

defineProps<{ email: string }>()
const emit = defineEmits<{ 'close': [deleted?: boolean], 'update:open': [open: boolean] }>()

const schema = deleteAccountSchema
const state = reactive({ password: '' })
const saving = ref(false)
const { isCompact: fullscreen } = useLayoutContext()

const form = useTemplateRef('form')
useFormErrorRecheck(form)
useSubmitShortcut(() => form.value?.submit())

const remove = useDeleteAccount()
/** The last refusal, in the server's words. */
const lastError = ref<string>()

async function onSubmit({ data }: FormSubmitEvent<DeleteAccountInput>) {
  lastError.value = undefined
  saving.value = true
  const result = await remove.execute(data)
  saving.value = false
  if (result.ok) {
    emit('close', true)
    return
  }
  if (result.status === 'error') {
    const field = result.error.fieldErrors?.password?.[0]
    if (field) form.value?.setErrors([{ name: 'password', message: field }])
    else lastError.value = result.error.message
  }
}
</script>

<template>
  <AppModal
    title="Delete your account?"
    description="This can't be undone."
    :fullscreen="fullscreen"
    :dismissible="!saving"
    :ui="{ footer: 'pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    @update:open="(open: boolean) => { if (!open) emit('close') }"
  >
    <template #body>
      <UForm
        id="delete-account-form"
        ref="form"
        :schema="schema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="saving"
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
          title="Not deleted"
          :description="lastError"
        />
        <ul class="list-disc space-y-1 ps-5 text-sm">
          <li>You're signed out on every device, and {{ email }} can't sign in any more.</li>
          <li>Your name, email and phone are removed in every cafe you've ordered from.</li>
          <li class="text-muted">
            The cafes keep your past orders for their records, without your name.
          </li>
          <li class="text-muted">
            You can create a new account with this email later.
          </li>
        </ul>
        <UFormField
          label="Your password"
          name="password"
          required
        >
          <PasswordInput
            id="delete-account-password"
            v-model="state.password"
            autocomplete="current-password"
            autofocus
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="Keep my account"
          color="neutral"
          variant="outline"
          :disabled="saving"
          class="max-sm:flex-1 max-sm:justify-center"
          @click="emit('close')"
        />
        <UButton
          type="submit"
          form="delete-account-form"
          label="Delete account"
          color="error"
          :loading="saving"
          class="max-sm:flex-1 max-sm:justify-center"
        />
      </div>
    </template>
  </AppModal>
</template>
