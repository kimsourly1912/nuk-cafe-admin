<script setup lang="ts">
/**
 * Counter sign-in (`/counter/sign-in`, D102): the admin sign-in's frame (D84), for branch staff,
 * managers and admins. An account that works at no branch is signed out again with a clear message.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import { counterRedirectTarget, useCounterSession } from '../composables/useCounterSession'

const schema = v.object({
  email: v.pipe(v.string(), v.trim(), v.minLength(1, 'Email is required'), v.email('Enter an email address')),
  password: v.pipe(v.string(), v.minLength(1, 'Password is required')),
})
type Schema = v.InferOutput<typeof schema>

const state = reactive({ email: '', password: '' })
const loading = ref(false)
// Hidden by default: staff sign in at the counter, where customers can see the screen.
const showPassword = ref(false)
const error = ref<string>()
/** After a password that needs a code (two-step sign-in, D188): the code step replaces the form. */
const codeStep = ref(false)
/** Refused here, but the account works at another cafe (T2c, D144): the alert offers Your cafes. */
const elsewhere = ref(false)

const route = useRoute()
const slug = useTenantSlug()
const { signIn, finishSignIn } = useCounterSession()
const { name, logoUrl } = useCafe()

// A failed step moves focus to what's wrong (page-patterns §5): the first invalid field, or the error.
const errorAlert = useTemplateRef<HTMLElement>('errorAlert')
const form = useTemplateRef('form')
useFormErrorRecheck(form)

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  error.value = undefined
  elsewhere.value = false
  try {
    if (await signIn(event.data) === 'two-factor') {
      codeStep.value = true
      state.password = ''
      return
    }
    await navigateTo(counterRedirectTarget(route.query.redirect, slug.value))
  }
  catch (e) {
    await showError(e)
  }
  finally {
    loading.value = false
  }
}

async function showError(e: unknown) {
  error.value = typeof e === 'string' ? e : getErrorMessage(e)
  elsewhere.value = typeof e !== 'string' && ApiError.from(e).code === WORKS_ELSEWHERE
  await nextTick()
  errorAlert.value?.focus()
}

/** The code was right (D188): finish the sign-in as after a password alone. */
async function onCodeVerified() {
  loading.value = true
  try {
    await finishSignIn()
    await navigateTo(counterRedirectTarget(route.query.redirect, slug.value))
  }
  catch (e) {
    codeStep.value = false
    await showError(e)
  }
  finally {
    loading.value = false
  }
}

async function restart(message?: string) {
  codeStep.value = false
  if (message) await showError(message)
  else error.value = undefined
}
</script>

<template>
  <TaskFrame>
    <template #header>
      <div class="flex items-center gap-2">
        <CafeLogo
          :url="logoUrl"
          class="size-6"
        />
        <h1 class="text-lg font-semibold">
          {{ name }} Counter
        </h1>
      </div>
    </template>

    <TwoFactorCodeForm
      v-if="codeStep"
      v-model:saving="loading"
      form-id="counter-sign-in-code"
      @verified="onCodeVerified()"
      @restart="restart"
    />

    <UForm
      v-else
      id="counter-sign-in"
      ref="form"
      :schema="schema"
      :state="state"
      class="space-y-4"
      @submit="onSubmit"
      @error="focusFirstInvalid"
    >
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
          :actions="elsewhere ? [{ label: 'Your cafes', icon: 'i-lucide-store', to: CAFES_PATH, color: 'error', variant: 'outline' }] : undefined"
        />
      </div>

      <UFormField
        label="Email"
        name="email"
        required
      >
        <UInput
          v-model="state.email"
          type="email"
          autocomplete="username"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Password"
        name="password"
        required
      >
        <UInput
          id="password"
          v-model="state.password"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="current-password"
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
              aria-controls="password"
              @click="showPassword = !showPassword"
            />
          </template>
        </UInput>
      </UFormField>
    </UForm>

    <template #footer>
      <div class="flex w-full flex-col gap-2">
        <UButton
          type="submit"
          :form="codeStep ? 'counter-sign-in-code' : 'counter-sign-in'"
          :label="codeStep ? 'Verify' : 'Sign in'"
          block
          :loading="loading"
        />
        <UButton
          v-if="codeStep"
          label="Back"
          color="neutral"
          variant="ghost"
          block
          :disabled="loading"
          @click="restart()"
        />
      </div>
    </template>
  </TaskFrame>
</template>
