<script setup lang="ts">
/**
 * Where the verification link lands (step 5.2, D97). Better Auth has verified the email and signed
 * the person in, or sent `?error=` (the link expired, was already replaced, or isn't ours: the page
 * says "doesn't work anymore" for all of them). A new link comes from here when signed in, else
 * after signing in.
 */
import { useAccountActions, useAccountSession, useResendCooldown } from '../composables/useCustomerAccount'
import { useAccountForm } from '../composables/useAccountForm'
import { ACCOUNT_PATHS, accountBackLabel, accountLink } from '../utils/account'
import { useAccountHome } from '../composables/useAccountHome'
import AccountFrame from './AccountFrame.vue'
import FormErrorAlert from './FormErrorAlert.vue'

const route = useRoute()
const home = useAccountHome()
const failed = computed(() => typeof route.query.error === 'string')

const { account, known, error: sessionError, refresh } = useAccountSession({ fresh: true })
const nuxtApp = useNuxtApp()
let announced = false
// Verification may have changed this browser's cookie on the server, outside the auth transport.
watch(known, (ready) => {
  if (ready && !failed.value && account.value && !announced) {
    announced = true
    void nuxtApp.callHook('app:auth-changed', 'login')
  }
})
const verifyReturn = computed(() => {
  const link = accountLink(ACCOUNT_PATHS.verifyEmail, route.query.redirect)
  return typeof link === 'string' ? link : `${link.path}?${new URLSearchParams(link.query)}`
})
const { resendVerification } = useAccountActions()
const assertActive = useAuthCompletion()
const { waiting, start: startCooldown, waitLabel } = useResendCooldown('verify')
const { saving, formError, submit } = useAccountForm()
const sent = ref(false)
watch(useSessionIdentity().generation, () => {
  sent.value = false
})

async function sendNewLink() {
  const email = account.value?.email
  if (!email) return
  await submit(async () => {
    await resendVerification(email, route.query.redirect)
    assertActive()
    sent.value = true
    startCooldown()
  })
}
</script>

<template>
  <TaskFrameSkeleton
    v-if="!known && !sessionError"
    :fields="0"
    message
  />
  <SessionCheckError
    v-else-if="sessionError && !known"
    :error="sessionError"
    @retry="refresh()"
  />
  <AccountFrame
    v-else-if="!failed || account?.emailVerified"
    title="Email verified"
    :description="account ? `You're signed in as ${account.name}.` : 'You can order as soon as the cafe is open.'"
    illustration="i-app-nuk-cafe-email-verified"
  >
    <template #footer>
      <UButton
        :to="home"
        :label="accountBackLabel(home)"
        block
      />
    </template>
  </AccountFrame>

  <AccountFrame
    v-else
    title="This link doesn't work anymore"
    description="Verification links work for 24 hours, and only the newest one works."
    icon="i-lucide-link-2-off"
    icon-color="warning"
    :back="{ label: accountBackLabel(home), to: home }"
  >
    <div
      v-if="sent || formError"
      class="space-y-4"
    >
      <FormErrorAlert :message="formError" />
      <UAlert
        v-if="sent && !formError"
        color="success"
        variant="subtle"
        icon="i-lucide-circle-check"
        :title="`We sent a new link to ${account?.email}.`"
        role="status"
      />
    </div>
    <template #footer>
      <UButton
        v-if="known && account"
        :label="waitLabel('Send a new link')"
        block
        :loading="saving"
        :disabled="waiting"
        @click="sendNewLink"
      />
      <UButton
        v-else
        :to="accountLink(ACCOUNT_PATHS.signIn, verifyReturn)"
        label="Sign in to get a new link"
        block
        :loading="!known"
      />
    </template>
  </AccountFrame>
</template>
