<script setup lang="ts">
/**
 * The account in the customer site's header (step 5.2, D97; revised in D124).
 * - Signed out: from `lg`, "Sign in", coming back to this page afterwards; below `lg` an icon
 *   opening Sign in, Create account and Appearance (the header has no light/dark button there).
 *   A guest (D156, signed in by Place order) is signed out here, with **Your orders** added.
 * - Signed in: the initials, opening the account menu (AccountMenuContent).
 *
 * Which signed-out button shows is CSS (both are rendered).
 *
 * The account is read in the browser only, so server-rendered pages stay the same for everyone:
 * until it's known, a placeholder the size of the button (D97).
 */
import { useCustomerAccount } from '../composables/useCustomerAccount'
import { ACCOUNT_PATHS, accountLink, initialsOf } from '../utils/account'
import AccountMenuContent from './AccountMenuContent.vue'
import AppearanceChoice from './AppearanceChoice.vue'

const route = useRoute()
const tenantPath = useTenantPath()
const { account, guest, known } = useCustomerAccount()
const open = ref(false)
const signedOutOpen = ref(false)

const signInLink = computed(() => accountLink(ACCOUNT_PATHS.signIn, route.fullPath))
/** The signed-out menu below `lg`. */
const signedOutLinks = computed(() => [
  ...(guest.value ? [{ label: 'Your orders', icon: 'i-lucide-receipt', to: tenantPath('/orders') }] : []),
  { label: 'Sign in', icon: 'i-lucide-log-in', to: signInLink.value },
  { label: 'Create account', icon: 'i-lucide-user-plus', to: accountLink(ACCOUNT_PATHS.signUp, route.fullPath) },
])
const initials = computed(() => (account.value ? initialsOf(account.value.name, account.value.email) : ''))
</script>

<template>
  <USkeleton
    v-if="!known"
    class="size-8 shrink-0 rounded-full"
  />

  <template v-else-if="!account">
    <!-- A guest (D156) has orders on this device: they stay reachable without an account -->
    <UButton
      v-if="guest"
      :to="tenantPath('/orders')"
      icon="i-lucide-receipt"
      label="Your orders"
      color="neutral"
      variant="ghost"
      class="shrink-0 max-lg:hidden"
    />
    <UButton
      :to="signInLink"
      icon="i-lucide-circle-user"
      label="Sign in"
      color="neutral"
      variant="outline"
      class="shrink-0 max-lg:hidden"
    />
    <UPopover
      v-model:open="signedOutOpen"
      :content="{ align: 'end' }"
    >
      <UButton
        icon="i-lucide-circle-user"
        color="neutral"
        variant="ghost"
        class="shrink-0 lg:hidden"
        aria-label="Account"
      />
      <template #content>
        <div class="w-60 space-y-1 p-2">
          <UButton
            v-for="link in signedOutLinks"
            :key="link.label"
            :label="link.label"
            :icon="link.icon"
            :to="link.to"
            color="neutral"
            variant="ghost"
            block
            class="justify-start"
            @click="signedOutOpen = false"
          />
          <USeparator class="my-1" />
          <AppearanceChoice />
        </div>
      </template>
    </UPopover>
  </template>

  <UPopover
    v-else
    v-model:open="open"
    :content="{ align: 'end' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      class="shrink-0 rounded-full p-0.5"
      :aria-label="`${initials}, account: ${account.name}`"
    >
      <UAvatar
        :text="initials"
        size="sm"
      />
    </UButton>
    <template #content>
      <AccountMenuContent
        :account="account"
        @close="open = false"
      />
    </template>
  </UPopover>
</template>
