<script setup lang="ts">
/**
 * The second step of a sign-in with two-step sign-in (P1b, D188): the 6-digit code from the
 * authenticator app, or one of the backup codes. Every sign-in page shows it in place of its
 * password form when the password step answers `two-factor`; `verified` means the session is set
 * and the page finishes its own sign-in, `restart` that the challenge is over (back to the password).
 * The page's submit button posts `form-id`.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'

const props = defineProps<{ formId: string }>()
const emit = defineEmits<{ verified: [], restart: [message: string] }>()

const method = ref<TwoFactorMethod>('app')
const state = reactive({ code: '' })
const error = ref<string>()
const saving = defineModel<boolean>('saving', { default: false })

const schema = computed(() => method.value === 'app'
  ? v.object({ code: v.pipe(v.string(), v.trim(), v.regex(/^\d{6}$/, 'Enter the 6 digits from your app')) })
  : v.object({ code: v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter a backup code')) }))

const errorAlert = useTemplateRef<HTMLElement>('errorAlert')
const form = useTemplateRef('form')
useFormErrorRecheck(form)

function switchMethod() {
  method.value = method.value === 'app' ? 'backup' : 'app'
  state.code = ''
  error.value = undefined
  form.value?.clear()
}

async function onSubmit({ data }: FormSubmitEvent<{ code: string }>) {
  saving.value = true
  error.value = undefined
  try {
    await verifyTwoFactorCode(method.value, data.code)
    emit('verified')
  }
  catch (e) {
    const apiError = ApiError.from(e)
    saving.value = false
    if (apiError.code === TWO_FACTOR_RESTART) {
      emit('restart', apiError.message)
      return
    }
    error.value = apiError.message
    state.code = ''
    await nextTick()
    errorAlert.value?.focus()
  }
}
</script>

<template>
  <UForm
    :id="props.formId"
    ref="form"
    :schema="schema"
    :state="state"
    :disabled="saving"
    class="space-y-4"
    @submit="onSubmit"
    @error="focusFirstInvalid"
  >
    <p class="text-sm text-muted">
      {{ method === 'app'
        ? 'Open your authenticator app and enter the 6-digit code for NUK Platform.'
        : 'Enter one of the backup codes you saved when you set up two-step sign-in. Each works once.' }}
    </p>

    <div
      v-if="error"
      ref="errorAlert"
      role="alert"
      tabindex="-1"
    >
      <UAlert
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="error"
      />
    </div>

    <UFormField
      :label="method === 'app' ? 'Code' : 'Backup code'"
      name="code"
      required
    >
      <UInput
        v-model="state.code"
        :inputmode="method === 'app' ? 'numeric' : 'text'"
        :autocomplete="method === 'app' ? 'one-time-code' : 'off'"
        :maxlength="method === 'app' ? 6 : 32"
        autofocus
        class="w-full"
        :ui="{ base: 'font-mono tracking-widest' }"
      />
    </UFormField>

    <UButton
      :label="method === 'app' ? 'Use a backup code instead' : 'Use the code from your app'"
      color="neutral"
      variant="link"
      size="sm"
      class="px-0"
      :disabled="saving"
      @click="switchMethod()"
    />
  </UForm>
</template>
