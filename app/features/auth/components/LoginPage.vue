<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import * as v from 'valibot'
import { loginRedirectTarget, useAuth } from '../composables/useAuth'

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
/**
 * A session the admin app refuses (D236), met on arriving here already signed in or after a refused
 * sign-in: `<WorkspaceRefused>` replaces the form. Until it's checked, the skeleton (D235).
 */
const { refused, checked } = useRefusedSession('admin')

const route = useRoute()
const slug = useTenantSlug()
const { name, logoUrl } = useCafe()
const { login, finishLogin } = useAuth()

// A failed step moves focus to what's wrong (page-patterns §5): the first invalid field, or the error.
const errorAlert = useTemplateRef<HTMLElement>('errorAlert')
const form = useTemplateRef('form')
useFormErrorRecheck(form)

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  error.value = undefined
  try {
    if (await login(event.data) === 'two-factor') {
      codeStep.value = true
      state.password = ''
      return
    }
    await navigateTo(loginRedirectTarget(route.query.redirect, slug.value))
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

/** Use another account: signed out, the form again for the next person. */
function onSignedOut() {
  refused.value = null
  state.email = ''
}

/** The code was right (D188): finish the sign-in as after a password alone. */
async function onCodeVerified() {
  loading.value = true
  try {
    await finishLogin()
    await navigateTo(loginRedirectTarget(route.query.redirect, slug.value))
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
    workspace="admin"
    :access="refused.access"
    :email="refused.email"
    :title="`${name} Admin`"
    @signed-out="onSignedOut"
  />

  <TaskFrame v-else>
    <template #header>
      <div class="flex items-center gap-2">
        <CafeLogo
          :url="logoUrl"
          class="size-6"
        />
        <h1 class="text-lg font-semibold">
          {{ name }} Admin
        </h1>
      </div>
    </template>

    <TwoFactorCodeForm
      v-if="codeStep"
      v-model:saving="loading"
      form-id="login-form-code"
      @verified="onCodeVerified()"
      @restart="restart"
    />

    <UForm
      v-else
      id="login-form"
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
          :form="codeStep ? 'login-form-code' : 'login-form'"
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
