<script setup lang="ts">
/**
 * Account security at a cafe's counter (`/c/<slug>/counter/account-security`, D242), from the user
 * menu: two-step sign-in for the signed-in staff member (`<AccountSecurity>`, shared with the
 * admin). Optional: never required at the counter (Q1).
 */
import { counterRedirectTarget, useCounterSession } from '../composables/useCounterSession'

const route = useRoute()
const slug = useTenantSlug()
const { user, twoFactorChanged } = useCounterSession()
</script>

<template>
  <!-- Per identity: another person signed in (another tab) never sees this one's setup key or codes. -->
  <AccountSecurity
    :key="user?.userId"
    :enabled="user?.twoFactorEnabled ?? false"
    :email="user?.email"
    :back-to="counterRedirectTarget(route.query.redirect, slug)"
    back-label="Back"
    :changed="twoFactorChanged"
  />
</template>
