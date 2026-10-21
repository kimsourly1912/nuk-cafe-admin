<script setup lang="ts">
/**
 * Platform console sign-in (`/platform/sign-in`, D142): the admin sign-in's frame (D84), for the
 * platform team. An account that isn't a super admin is signed out again with a clear message. With
 * two-step sign-in (D188) the password is followed by the code from the app (`<TwoFactorCodeForm>`).
 */
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import { platformRedirectTarget, usePlatformSession } from '../composables/usePlatformSession'

const schema = v.object({
  email: v.pipe(v.string(), v.trim(), v.minLength(1, 'Email is required'), v.email('Enter an email address')),
  password: v.pipe(v.string(), v.minLength(1, 'Password is required')),
})
type Schema = v.InferOutput<typeof schema>

const state = reactive({ email: '', password: '' })
const loading = ref(false)
// Hidden by default, like every sign-in.
const showPassword = ref(false)
const error = ref<string>()

const route = useRoute()
const { signIn, finishSignIn } = usePlatformSession()
/** After a password that needs a code: the code step replaces the password form. */
const codeStep = ref(false)

// A failed step moves focus to what's wrong (page-patterns §5): the first invalid field, or the error.
const errorAlert = useTemplateRef<HTMLElement>('errorAlert')
const form = useTemplateRef('form')
useFormErrorRecheck(form)
// The form keeps its fields disabled until after this event (`loadingAuto`, re-enabled in its
// `finally`), and a disabled field can't take focus: focus on the next frame, once they're enabled.
function focusFirstInvalid(event: FormErrorEvent) {
  const id = event.errors[0]?.id
  if (id) requestAnimationFrame(() => document.getElementById(id)?.focus())
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  error.value = undefined
  try {
    if (await signIn(event.data) === 'two-factor') {
      codeStep.value = true
      state.password = ''
      return
    }
    await navigateTo(platformRedirectTarget(route.query.redirect))
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
  await nextTick()
  errorAlert.value?.focus()
}

async function onCodeVerified() {
  loading.value = true
  try {
    await finishSignIn()
    await navigateTo(platformRedirectTarget(route.query.redirect))
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
        <UIcon
          name="i-lucide-layers"
          class="size-6 text-primary"
        />
        <h1 class="text-lg font-semibold">
          NUK Platform
        </h1>
      </div>
    </template>

    <TwoFactorCodeForm
      v-if="codeStep"
      v-model:saving="loading"
      form-id="platform-sign-in-code"
      @verified="onCodeVerified()"
      @restart="restart"
    />

    <UForm
      v-else
      id="platform-sign-in"
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
          :form="codeStep ? 'platform-sign-in-code' : 'platform-sign-in'"
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
