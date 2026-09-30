<script setup lang="ts">
/**
 * The counter's header (D102, the owner's frames): NUK Cafe, the branch and whether it's open, the
 * order search (on the queue), Sold out (the page that switches items off, 6.3c, D105), the color
 * mode and the user menu (the chime on or off, another branch, change password, sign out).
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import { COUNTER_CHANGE_PASSWORD_PATH, COUNTER_HOME_PATH, useCounterSession } from '../composables/useCounterSession'

defineProps<{
  branchName: string
  openNow: boolean | null
  /** The Sold out page's address; the button is left out on that page itself. */
  soldOutTo?: string
}>()
/** The queue's order search; left out when not bound (the Sold out page has its own). */
const search = defineModel<string | undefined>('search', { default: undefined })
const muted = defineModel<boolean>('muted', { required: true })

const { user, signOut } = useCounterSession()
const initials = computed(() => (user.value?.name || user.value?.email || '?').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase())

const menu = computed<DropdownMenuItem[][]>(() => [
  [{ label: user.value?.name || user.value?.email, description: user.value?.email, type: 'label' }],
  [
    { label: muted.value ? 'Turn on the new-order sound' : 'Mute the new-order sound', icon: muted.value ? 'i-lucide-bell' : 'i-lucide-bell-off', onSelect: () => { muted.value = !muted.value } },
    ...((user.value?.branches.length ?? 0) > 1 ? [{ label: 'Another branch', icon: 'i-lucide-store', to: COUNTER_HOME_PATH }] : []),
    { label: 'Change password', icon: 'i-lucide-key-round', to: COUNTER_CHANGE_PASSWORD_PATH },
  ],
  [{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: () => signOut() }],
])
</script>

<template>
  <header class="sticky top-0 z-10 border-b border-default bg-default">
    <div class="flex h-16 items-center gap-3 px-4">
      <div class="min-w-0">
        <p class="flex items-center gap-2 font-semibold text-highlighted">
          <UIcon
            name="i-lucide-coffee"
            class="size-5 shrink-0 text-primary"
          />
          <span class="max-sm:hidden">NUK Cafe</span>
          <span class="text-muted max-sm:hidden">·</span>
          <span class="truncate">{{ branchName }}</span>
        </p>
      </div>
      <UBadge
        v-if="openNow !== null"
        :label="openNow ? 'Open' : 'Closed'"
        :color="openNow ? 'success' : 'neutral'"
        variant="subtle"
        class="shrink-0"
      />
      <div class="ms-auto" />
      <UInput
        v-if="search !== undefined"
        v-model="search"
        icon="i-lucide-search"
        placeholder="Order number"
        aria-label="Search orders by number or name"
        class="w-32 sm:w-72"
      />
      <UButton
        v-if="soldOutTo"
        :to="soldOutTo"
        icon="i-lucide-ban"
        label="Sold out"
        color="neutral"
        variant="outline"
        :ui="{ label: 'max-sm:sr-only' }"
      />
      <UColorModeButton class="max-sm:hidden" />
      <UDropdownMenu
        :items="menu"
        :content="{ align: 'end' }"
      >
        <UButton
          :label="initials"
          color="neutral"
          variant="soft"
          class="rounded-full"
          :aria-label="`Account: ${user?.name || user?.email}`"
        />
      </UDropdownMenu>
    </div>
  </header>
</template>
