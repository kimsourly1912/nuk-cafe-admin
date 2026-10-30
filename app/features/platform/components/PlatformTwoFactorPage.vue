<script setup lang="ts">
/**
 * Set up two-step sign-in (`/platform/two-factor`, P1b, D188): required before any other console
 * page (the route middleware sends every page here until it's on). The steps are the shared
 * `<TwoFactorSetupFrame>` (D242); once on, the page goes where it was asked to.
 */
import { platformRedirectTarget, usePlatformSession } from '../composables/usePlatformSession'

const route = useRoute()
const { user, twoFactorChanged, signOut } = usePlatformSession()

async function finish() {
  twoFactorChanged(true)
  await navigateTo(platformRedirectTarget(route.query.redirect))
}
</script>

<template>
  <!-- Per identity: another person signed in (another tab) never sees this one's setup key or codes. -->
  <TwoFactorSetupFrame
    :key="user?.userId"
    intro="The platform console needs a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) as well as your password, so a stolen password alone can't open it."
    :email="user?.email"
    :done="finish"
  >
    <template #secondary="{ saving }">
      <UButton
        label="Log out"
        color="neutral"
        variant="ghost"
        block
        :disabled="saving"
        @click="signOut()"
      />
    </template>
  </TwoFactorSetupFrame>
</template>
