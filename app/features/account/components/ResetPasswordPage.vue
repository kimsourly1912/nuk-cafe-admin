<script setup lang="ts">
/**
 * Choose a new password (step 5.2, D97), where the reset link lands: Better Auth checked the link
 * and sent `?token=`, or `?error=INVALID_TOKEN` (expired or used; the page doesn't tell them apart,
 * the server doesn't either). One password field with a show button and the rules' checklist (D210), no "confirm". Saving signs the
 * account out everywhere and goes to sign-in, which says the password changed.
 *
 * The token leaves the address bar once read, so it isn't kept in the history or sent on as a
 * referrer.
 */
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ResetPasswordForm } from '../schemas/account-form'
import { resetPasswordSchema } from '../schemas/account-form'
import { useAccountActions } from '../composables/useCustomerAccount'
import { useAccountForm } from '../composables/useAccountForm'
import { ACCOUNT_ASIDES, ACCOUNT_PATHS, accountLink, isDeadLink } from '../utils/account'
import AccountFrame from './AccountFrame.vue'
import AccountAside from './AccountAside.vue'
import FormErrorAlert from './FormErrorAlert.vue'
import PasswordInput from './PasswordInput.vue'

const route = useRoute()
const token = shallowRef<string>()
const ready = ref(false)
const dead = ref(false)
const signInLink = computed(() => accountLink(ACCOUNT_PATHS.signIn, route.query.redirect))
function readToken() {
  if (typeof route.query.token === 'string') {
    token.value = route.query.token
    dead.value = false
    const { token: _token, ...query } = route.query
    void navigateTo({ path: route.path, query }, { replace: true })
  }
  else if (!token.value) dead.value = true
  if (typeof route.query.error === 'string') dead.value = true
  ready.value = true
}
onMounted(readToken)
watch(() => route.query.token, (value) => {
  if (import.meta.client && value) readToken()
})
onScopeDispose(() => {
  token.value = undefined
})

const state = reactive({ password: '' })
const { saving, formError, submit } = useAccountForm({ formId: 'reset-form', fields: ['password'] }, state)
const { resetPassword } = useAccountActions()
const assertActive = useAuthCompletion()
watch(useSessionIdentity().generation, () => {
  token.value = undefined
  if (!saving.value) dead.value = true
})
/** The password the server refused as breached, for the checklist. */
const refusedPassword = ref<string>()
/** The last password Generate made: random, so the checklist skips its leaked-password check. */
const generatedPassword = ref<string>()

async function onSubmit(event: FormSubmitEvent<ResetPasswordForm>) {
  let deadNow = false
  await submit(async () => {
    try {
      await resetPassword(token.value!, event.data.password)
      assertActive()
    }
    catch (error) {
      if (ApiError.from(error).kind === 'aborted') {
        deadNow = true
        throw error
      }
      if (isBreachedPassword(error)) refusedPassword.value = event.data.password
      if (!isDeadLink(error)) throw error
      token.value = undefined
      deadNow = true
      return
    }
    token.value = undefined
    await navigateTo({ path: ACCOUNT_PATHS.signIn, query: { reset: '1', ...(typeof route.query.redirect === 'string' ? { redirect: route.query.redirect } : {}) } })
  })
  if (deadNow) dead.value = true
}
</script>

<template>
  <TaskFrameSkeleton
    v-if="!ready"
    :fields="1"
  >
    <template #aside>
      <AccountAside v-bind="ACCOUNT_ASIDES.resetPassword" />
    </template>
  </TaskFrameSkeleton>
  <AccountFrame
    v-else-if="dead"
    title="This link doesn't work anymore"
    description="Reset links work once, for 1 hour."
    icon="i-lucide-link-2-off"
    icon-color="warning"
    :back="{ label: 'Back to sign in', to: signInLink }"
    :aside="ACCOUNT_ASIDES.resetPassword"
  >
    <template #footer>
      <UButton
        :to="accountLink(ACCOUNT_PATHS.forgotPassword, route.query.redirect)"
        label="Send a new link"
        block
      />
    </template>
  </AccountFrame>

  <AccountFrame
    v-else
    title="Choose a new password"
    :back="{ label: 'Back to sign in', to: signInLink }"
    :aside="ACCOUNT_ASIDES.resetPassword"
  >
    <UForm
      id="reset-form"
      ref="form"
      :schema="resetPasswordSchema"
      :state="state"
      :validate-on="['input', 'change']"
      class="space-y-4"
      @submit="onSubmit"
      @error="focusFirstInvalid"
    >
      <FormErrorAlert :message="formError" />
      <div class="space-y-2">
        <UFormField
          label="New password"
          name="password"
          required
        >
          <PasswordInput
            id="reset-password"
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
      <UAlert
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        title="You'll be signed out on your other devices."
      />
    </UForm>
    <template #footer>
      <UButton
        type="submit"
        form="reset-form"
        label="Save password"
        block
        :loading="saving"
      />
    </template>
  </AccountFrame>
</template>
