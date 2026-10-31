<script setup lang="ts">
/**
 * Account security in a cafe's admin (`/c/<slug>/admin/account-security`, D242), from the user
 * menu: two-step sign-in for the signed-in owner (`<AccountSecurity>`, shared with the counter).
 */
import { loginRedirectTarget, useAuth } from '../composables/useAuth'

const route = useRoute()
const slug = useTenantSlug()
const { user, twoFactorChanged } = useAuth()
</script>

<template>
  <!-- Per identity: another person signed in (another tab) never sees this one's setup key or codes. -->
  <AccountSecurity
    :key="user?.userId"
    :enabled="user?.twoFactorEnabled ?? false"
    :email="user?.email"
    :back-to="loginRedirectTarget(route.query.redirect, slug)"
    back-label="Back"
    :changed="twoFactorChanged"
  />
</template>
