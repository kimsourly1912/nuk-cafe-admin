<script setup lang="ts">
/**
 * A signed-in account in the site root's header (D221 follow-up): the one place it works
 * (`homeDestination`: the workspace, Your cafes or the console; nothing for a customer) and its
 * initials, opening a menu with those places, Appearance on a phone, and Sign out. Below `sm` the
 * button is hidden and the menu alone opens them, so the header fits a phone.
 *
 * Mounted only once the browser knows who is signed in, so the cafes are never read on the server
 * render that `/` caches for everyone.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { type AccountIdentity, initialsOf, useAccountActions } from '~/features/account'
import { useAccountCafes, usePlatformTeam } from '~/features/cafe'
import { CAFES_PATH, PLATFORM_CONSOLE_PATH } from '~/utils/account-cafes'
import { homeDestination, YOUR_CAFES } from '../utils/home-destination'

const props = defineProps<{ account: AccountIdentity }>()

const notify = useNotify()
const { signOut } = useAccountActions()
const { data: cafes, error, loading } = useAccountCafes()
const { data: platformTeam, known: teamKnown, error: teamError } = usePlatformTeam()

const checking = computed(() => loading.value || (!teamKnown.value && !teamError.value))
// Not readable here: Your cafes reads them again and offers Try again.
const destination = computed(() => (error.value || teamError.value ? YOUR_CAFES : homeDestination(cafes.value ?? [], platformTeam.value)))
const initials = computed(() => initialsOf(props.account.name, props.account.email))

// Below `sm` the header hides its light/dark button (`HomeAccount`): Light or Dark here instead, no
// "System", like the customer site's account menu (D96, D124).
const phone = useBreakpoints(breakpointsTailwind).smaller('sm')
const colorMode = useColorMode()
const appearance = computed<DropdownMenuItem[]>(() => [
  { type: 'label', label: 'Appearance' },
  ...([['light', 'Light', 'i-lucide-sun'], ['dark', 'Dark', 'i-lucide-moon']] as const).map(([value, label, icon]) => ({
    type: 'checkbox' as const,
    label,
    icon,
    checked: colorMode.value === value,
    onUpdateChecked: () => {
      colorMode.preference = value
    },
  })),
])

const items = computed<DropdownMenuItem[][]>(() => [
  [{ type: 'label' as const, label: props.account.name, description: props.account.email }],
  [
    // The workspace the header's button opens: that button is hidden below `sm`, so it's here too.
    ...(destination.value?.cafeName ? [{ label: destination.value.label, description: destination.value.cafeName, icon: destination.value.icon, to: destination.value.to, external: true }] : []),
    ...(cafes.value?.length || error.value || teamError.value ? [{ label: 'Your cafes', icon: 'i-lucide-store', to: CAFES_PATH }] : []),
    ...(platformTeam.value ? [{ label: 'Platform console', icon: 'i-lucide-layers', to: PLATFORM_CONSOLE_PATH, external: true }] : []),
  ],
  phone.value ? appearance.value : [],
  [{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: () => void signOutNow() }],
].filter(group => group.length))

async function signOutNow() {
  try {
    await signOut()
    notify.success('Signed out')
  }
  catch (signOutError) {
    notify.error('Couldn\'t sign out', signOutError)
  }
}
</script>

<template>
  <UButton
    v-if="checking"
    label="Loading…"
    loading
    disabled
    color="neutral"
    variant="subtle"
    aria-busy="true"
    class="max-sm:hidden"
  />
  <!-- Below `sm` only the initials: the menu opens the same places. -->
  <UButton
    v-else-if="destination"
    class="max-sm:hidden"
    :label="destination.label"
    :icon="destination.icon"
    :to="destination.to"
    :external="destination.external"
    :aria-label="destination.cafeName ? `${destination.label}, ${destination.cafeName}` : undefined"
  />
  <UDropdownMenu
    :items="items"
    :content="{ align: 'end' }"
    :ui="{ content: 'min-w-60' }"
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
        :ui="{ fallback: 'text-xs' }"
      />
    </UButton>
  </UDropdownMenu>
</template>
