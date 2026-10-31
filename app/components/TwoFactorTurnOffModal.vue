<script setup lang="ts">
/**
 * "Turn off two-step sign-in?" (D242): the password, then Better Auth turns it off. Open via
 * `useOverlay().create(TwoFactorTurnOffModal)`; emits `close(true)` once off, `close()` otherwise. A
 * refusal stays here (a wrong password beside the field, anything else above it), the password kept
 * for a retry.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'

const emit = defineEmits<{ 'close': [off?: boolean], 'update:open': [open: boolean] }>()

const schema = v.object({ password: v.pipe(v.string(), v.minLength(1, 'Password is required')) })
const state = reactive({ password: '' })
const showPassword = ref(false)
const { isCompact: fullscreen } = useLayoutContext()

const form = useTemplateRef('form')
useFormErrorRecheck(form)
useSubmitShortcut(() => form.value?.submit())

const twoFactor = useTwoFactorSettings()
const turnOff = useMutation((password: string) => twoFactor.turnOff(password), {
  id: 'account:two-factor-off',
  successMessage: 'Two-step sign-in is off',
  errorMessage: 'Two-step sign-in is still on',
  // Staff shows each person's status.
  invalidate: ['staff'],
})
/** The last refusal that isn't about the password field. */
const lastError = ref<string>()

async function onSubmit({ data }: FormSubmitEvent<v.InferOutput<typeof schema>>) {
  lastError.value = undefined
  const result = await turnOff.execute(data.password)
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
    title="Turn off two-step sign-in?"
    description="Your account will be protected by your password only."
    :fullscreen="fullscreen"
    :dismissible="!turnOff.pending"
    :ui="{ footer: 'pb-[max(env(safe-area-inset-bottom),1rem)]' }"
    @update:open="(open: boolean) => { if (!open) emit('close') }"
  >
    <template #body>
      <UForm
        id="two-factor-off-form"
        ref="form"
        :schema="schema"
        :state="state"
        :validate-on="['input', 'change']"
        :disabled="turnOff.pending"
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
          title="Still on"
          :description="lastError"
        />
        <UFormField
          label="Your password"
          name="password"
          required
        >
          <UInput
            id="two-factor-off-password"
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
                aria-controls="two-factor-off-password"
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
          :disabled="turnOff.pending"
          class="max-sm:flex-1 max-sm:justify-center"
          @click="emit('close')"
        />
        <UButton
          type="submit"
          form="two-factor-off-form"
          label="Turn off"
          color="error"
          :loading="turnOff.pending"
          class="max-sm:flex-1 max-sm:justify-center"
        />
      </div>
    </template>
  </AppModal>
</template>
