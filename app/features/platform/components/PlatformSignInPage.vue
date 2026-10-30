<script setup lang="ts">
/**
 * Platform console sign-in (`/platform/sign-in`, D142): the admin sign-in's frame (D84), for the
 * platform team. An account off the team that works at a cafe stays signed in and sees
 * `<WorkspaceRefused>` with Your cafes; one that works nowhere (a customer) is signed out again with a
 * clear message (D241). Arriving already signed in by an account off the team: the panel at once, Back
 * to home for a customer. With two-step sign-in (D188) the password is followed by the code from the
 * app (`<TwoFactorCodeForm>`).
 */
import type { FormSubmitEvent } from '@nuxt/ui'
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
/**
 * A session the console refuses (D241), met on arriving here already signed in or after a refused
 * sign-in: `<WorkspaceRefused>` replaces the form. Until it's checked, the skeleton (D238).
 */
const { refused, checked } = useRefusedSession('console')

// A failed step moves focus to what's wrong (page-patterns §5): the first invalid field, or the error.
const errorAlert = useTemplateRef<HTMLElement>('errorAlert')
const form = useTemplateRef('form')
useFormErrorRecheck(form)

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
  if (e instanceof WorkspaceRefusedError) {
    refused.value = { email: state.email, access: e.access }
    state.password = ''
    return
  }
  error.value = typeof e === 'string' ? e : getErrorMessage(e)
  await nextTick()
  errorAlert.value?.focus()
}

/** Try again after a check that failed (Q4); see the admin's `LoginPage`. */
const retrying = ref(false)
async function onRetry() {
  retrying.value = true
  try {
    await finishSignIn()
    await navigateTo(platformRedirectTarget(route.query.redirect))
  }
  catch (e) {
    if (e instanceof WorkspaceRefusedError) {
      if (refused.value) refused.value = { ...refused.value, access: e.access }
      return
    }
    if (ApiError.from(e).kind === 'forbidden') {
      refused.value = null
      await showError(e)
    }
  }
  finally {
    retrying.value = false
  }
}

/** Use another account: signed out, the form again for the next person. */
function onSignedOut() {
  refused.value = null
  state.email = ''
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
  <TaskFrameSkeleton
    v-if="!checked"
    :fields="2"
    cafe
  />
  <WorkspaceRefused
    v-else-if="refused"
    workspace="console"
    :access="refused.access"
    :email="refused.email"
    title="Angder"
    :retrying="retrying"
    @signed-out="onSignedOut"
    @retry="onRetry"
  />

  <TaskFrame v-else>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-layers"
          class="size-6 text-primary"
        />
        <h1 class="text-lg font-semibold">
          Angder
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
      :validate-on="['input', 'change']"
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
