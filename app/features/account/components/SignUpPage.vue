<script setup lang="ts">
/**
 * Create an account (step 5.2, D97): name, email, password. The account is signed in at once and
 * Better Auth sends the verification email; next is "Check your email" (`/verify-email`), carrying
 * `?redirect=` on. An existing email or a breached password shows on its field.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { SignUpForm } from '../schemas/account-form'
import { signUpSchema } from '../schemas/account-form'
import { useAccountActions, useAccountSession } from '../composables/useCustomerAccount'
import { useAccountForm } from '../composables/useAccountForm'
import { ACCOUNT_ASIDES, ACCOUNT_PATHS, accountBackLabel, accountLink, accountRedirectTarget } from '../utils/account'
import { useAccountHome } from '../composables/useAccountHome'
import AccountAside from './AccountAside.vue'
import AccountFrame from './AccountFrame.vue'
import FormErrorAlert from './FormErrorAlert.vue'
import PasswordInput from './PasswordInput.vue'
import { useAccountProviders } from '../composables/useAccountProviders'
import { useGoogleSignInPopup } from '../composables/useGoogleSignInPopup'

const route = useRoute()
const { googleEnabled, known: providersKnown, error: providersError, refresh: refreshProviders } = useAccountProviders()
const home = useAccountHome()
const target = computed(() => accountRedirectTarget(route.query.redirect, home.value))

const state = reactive({ name: '', email: '', password: '' })
const { saving, formError, submit } = useAccountForm({ formId: 'sign-up-form', fields: ['name', 'email', 'password'] }, state)
const { signUp, finishSignIn } = useAccountActions()
const assertActive = useAuthCompletion()
const googlePopup = useGoogleSignInPopup()
const codeStep = ref(false)

const { account, known, error: sessionError, refresh } = useAccountSession({ fresh: true })
/** Already signed in on arrival: on its way on, so the form never shows (D238). */
const leaving = ref(false)
watch([known, account], async ([isKnown, current]) => {
  if (isKnown && current && !saving.value && !leaving.value) {
    leaving.value = true
    try {
      await navigateTo(target.value, { replace: true })
    }
    finally {
      leaving.value = false
    }
  }
}, { immediate: true })
const loading = computed(() => (!known.value && !sessionError.value && !saving.value) || (!providersKnown.value && !providersError.value) || leaving.value)

/** The password the server refused as breached, for the checklist. */
const refusedPassword = ref<string>()
/** The last password Generate made: random, so the checklist skips its leaked-password check. */
const generatedPassword = ref<string>()

async function onGoogleSignIn() {
  if (saving.value) return
  await submit(async () => {
    const step = await googlePopup.open(route.query.redirect)
    if (step === 'two-factor') {
      codeStep.value = true
      state.password = ''
      return
    }
    assertActive()
    await navigateTo(target.value)
  })
}

async function onSubmit(event: FormSubmitEvent<SignUpForm>) {
  if (saving.value) return
  await submit(async () => {
    try {
      await signUp(event.data, route.query.redirect)
      assertActive()
    }
    catch (error) {
      if (isBreachedPassword(error)) refusedPassword.value = event.data.password
      throw error
    }
    await navigateTo(accountLink(ACCOUNT_PATHS.verifyEmail, route.query.redirect))
  })
}
async function onCodeVerified() {
  let completed = false
  await submit(async () => {
    await finishSignIn()
    assertActive()
    await navigateTo(target.value)
    completed = true
  })
  if (!completed) codeStep.value = false
}

function restart(message?: string) {
  codeStep.value = false
  formError.value = message
}
</script>

<template>
  <TaskFrameSkeleton
    v-if="loading"
    :fields="3"
  >
    <template #aside>
      <AccountAside v-bind="ACCOUNT_ASIDES.signUp" />
    </template>
  </TaskFrameSkeleton>
  <SessionCheckError
    v-else-if="sessionError && !known && !saving"
    :error="sessionError"
    @retry="refresh()"
  >
    <template #aside>
      <AccountAside v-bind="ACCOUNT_ASIDES.signUp" />
    </template>
  </SessionCheckError>
  <AccountFrame
    v-else
    title="Create an account"
    description="Order ahead and collect points. It takes a minute."
    :aside="ACCOUNT_ASIDES.signUp"
    height="tall"
    :back="{ label: accountBackLabel(home), to: home }"
  >
    <TwoFactorCodeForm
      v-if="codeStep"
      v-model:saving="saving"
      form-id="sign-up-code"
      @verified="onCodeVerified()"
      @restart="restart"
    />
    <UForm
      v-else
      id="sign-up-form"
      ref="form"
      :schema="signUpSchema"
      :state="state"
      :disabled="saving"
      :validate-on="['input', 'change']"
      class="space-y-4"
      @submit="onSubmit"
      @error="focusFirstInvalid"
    >
      <FormErrorAlert :message="formError" />
      <ApiErrorAlert
        v-if="providersError"
        title="Could not check Google sign-in"
        :error="providersError"
        @retry="refreshProviders()"
      />
      <GoogleSignInButton
        :enabled="googleEnabled"
        :disabled="saving"
        :pending="googlePopup.pending.value"
        @click="onGoogleSignIn"
      />

      <UFormField
        label="Name"
        name="name"
        required
      >
        <UInput
          v-model="state.name"
          autocomplete="name"
          icon="i-lucide-user"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Email"
        name="email"
        required
      >
        <UInput
          v-model="state.email"
          type="email"
          autocomplete="email"
          icon="i-lucide-mail"
          class="w-full"
        />
      </UFormField>

      <div class="space-y-2">
        <UFormField
          label="Password"
          name="password"
          required
        >
          <PasswordInput
            id="sign-up-password"
            v-model="state.password"
            autocomplete="new-password"
            @generate="generatedPassword = $event"
          />
        </UFormField>
        <PasswordRequirements
          :password="state.password"
          :refused="refusedPassword"
          :generated="generatedPassword"
        />
      </div>
    </UForm>

    <template #footer>
      <UButton
        type="submit"
        :form="codeStep ? 'sign-up-code' : 'sign-up-form'"
        :label="codeStep ? 'Verify' : 'Create account'"
        block
        :loading="saving && !googlePopup.pending.value"
        :disabled="saving"
      />
      <UButton
        v-if="codeStep"
        label="Back"
        color="neutral"
        variant="ghost"
        block
        :disabled="saving"
        @click="restart()"
      />
      <p
        v-else
        class="text-center text-sm text-muted"
      >
        Already have an account?
        <ULink
          :to="accountLink(ACCOUNT_PATHS.signIn, route.query.redirect)"
          class="font-medium text-primary"
        >
          Sign in
        </ULink>
      </p>
    </template>
  </AccountFrame>
</template>
