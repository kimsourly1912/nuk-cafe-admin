<script setup lang="ts">
/**
 * The account in the site root's header, with the light/dark button (D221 follow-up). Signed out, a
 * guest (D156) or on a temporary password: Sign in, to Your cafes, which sends the person to sign in
 * and back. Signed in: where the account works and its menu (`HomeAccountSignedIn`); below `sm` the
 * light/dark button moves into that menu, as on the customer site (D124), so the header fits a phone.
 *
 * The session is read in the browser only: `/` is cached as one page for every visitor (`swr`), so
 * the server renders a loading button in its place until the browser knows (D97).
 */
import { useAccountSession } from '~/features/account'
// Your cafes, `/cafes` (not the console's `/platform/cafes`).
import { CAFES_PATH } from '~/utils/account-cafes'
import HomeAccountSignedIn from './HomeAccountSignedIn.vue'

const { account, known } = useAccountSession()
</script>

<template>
  <UColorModeButton :class="account ? 'max-sm:hidden' : undefined" />
  <UButton
    v-if="!known"
    label="Loading…"
    loading
    disabled
    color="neutral"
    variant="subtle"
    aria-busy="true"
  />
  <UButton
    v-else-if="!account"
    :to="CAFES_PATH"
    label="Sign in"
    icon="i-lucide-log-in"
  />
  <HomeAccountSignedIn
    v-else
    :account="account"
  />
</template>
