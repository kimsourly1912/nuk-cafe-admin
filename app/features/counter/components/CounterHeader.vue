<script setup lang="ts">
/**
 * The counter's header (D102, the owner's frames): the cafe (D143), the branch and whether it's open, the
 * order search (on the queue), Sold out (the page that switches items off, 6.3c, D105), Manage for
 * managers and owners (Dining tables and Reports, D198; Pause or Resume online orders, D199; never
 * shown to staff, and the server checks the role again), the color mode and the user menu (the chime on or off, another branch, another cafe (D144), change password,
 * install app (D203), sign out).
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { PublicBranch } from '#shared/contracts/branches'
import { useAccountCafes } from '~/features/cafe'
import { useBranchPause } from '../composables/useBranchPause'
import { useCounterMuted } from '../composables/useCounterQueue'
import CounterPauseModal from './CounterPauseModal.vue'
import { counterChangePasswordPath, counterHomePath, useCounterSession } from '../composables/useCounterSession'

const props = withDefaults(defineProps<{
  branchId: string
  /** The Sold out button; left out on the Sold out page itself. */
  soldOutButton?: boolean
}>(), { soldOutButton: true })
/** The queue's order search; left out when not bound (the other pages have their own). */
const search = defineModel<string | undefined>('search', { default: undefined })

// `/` focuses the order search, like the list search boxes (the hint shows while it's empty).
const searchInput = useTemplateRef('searchInput')
// Only where the header has the search: the Finished and Sold out pages bring their own.
if (search.value !== undefined) usePageShortcuts({ '/': () => searchInput.value?.inputRef?.focus() })

const { user, signOut } = useCounterSession()
const slug = useTenantSlug()
const tenantPath = useTenantPath()
// The branch, whether it's open and the chime setting come from here, so every page passes only the branch.
const branch = computed(() => user.value?.branches.find(b => b.id === props.branchId) ?? null)
const status = useApiQuery('counter:branch-status', () => apiFetch<PublicBranch[]>('/public/branches'), { server: false })
const openNow = computed(() => status.data.value?.find(b => b.id === props.branchId)?.openNow ?? null)
const soldOutTo = computed(() => (props.soldOutButton && branch.value ? tenantPath(`/counter/${branch.value.id}/sold-out`) : undefined))
// Online orders paused (D199): the badge says so to everyone at the counter.
const { pausedUntil, resume } = useBranchPause(() => props.branchId)
const pauseModal = useOverlay().create(CounterPauseModal)

// A manager's tools (D198): the role is the one at this branch (an owner's is `admin`).
const manage = computed<DropdownMenuItem[][]>(() => branch.value && branch.value.role !== 'staff'
  ? [
      [pausedUntil.value
        ? { label: 'Resume online orders', icon: 'i-lucide-play', onSelect: () => void resume.execute(props.branchId) }
        : { label: 'Pause online orders…', icon: 'i-lucide-pause', disabled: openNow.value === false, onSelect: () => void pauseModal.open({ branchId: props.branchId }) }],
      [
        { label: 'Reports', icon: 'i-lucide-chart-column', to: tenantPath(`/counter/${branch.value.id}/reports/summary`) },
        { label: 'Dining tables', icon: 'i-lucide-armchair', to: tenantPath(`/counter/${branch.value.id}/tables`) },
      ],
    ]
  : [])
const muted = useCounterMuted()
const { name, logoUrl } = useCafe()
// Someone who works at more than one cafe (T2c, D144) can open another one's counter from Your cafes.
const { data: cafes } = useAccountCafes()
const elsewhere = computed(() => otherCafes(cafes.value, slug.value, 'counter').length > 0)
const installApp = useInstallApp()
const initials = computed(() => (user.value?.name || user.value?.email || '?').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase())

const menu = computed<DropdownMenuItem[][]>(() => [
  [{ label: user.value?.name || user.value?.email, description: user.value?.email, type: 'label' }],
  [
    ...((user.value?.branches.length ?? 0) > 1 ? [{ label: 'Another branch', icon: 'i-lucide-store', to: counterHomePath(slug.value) }] : []),
    ...(elsewhere.value ? [{ label: 'Another cafe', icon: 'i-lucide-arrow-left-right', to: CAFES_PATH }] : []),
    { label: 'Change password', icon: 'i-lucide-key-round', to: counterChangePasswordPath(slug.value) },
    { label: muted.value ? 'Turn on the new-order sound' : 'Mute the new-order sound', icon: muted.value ? 'i-lucide-bell' : 'i-lucide-bell-off', onSelect: () => { muted.value = !muted.value } },
    // Not inside the installed app itself (D203).
    ...(installApp.installed.value ? [] : [{ label: 'Install app', icon: 'i-lucide-monitor-smartphone', onSelect: () => void installApp.install(name.value ? `${name.value} Counter` : 'Counter') }]),
  ],
  [{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: () => signOut() }],
])
</script>

<template>
  <header class="sticky top-0 z-10 border-b border-accented bg-default shadow-xs">
    <!-- Below sm the search drops to its own full-width row so nothing is squeezed; from sm it sits inline. -->
    <div class="mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:flex-nowrap sm:py-0">
      <!-- One block that may shrink (the name truncates), so the buttons stay on the first row on a phone. -->
      <div class="flex min-w-0 items-center gap-2 max-sm:flex-1">
        <p class="flex min-w-0 items-center gap-2 font-semibold text-highlighted">
          <CafeLogo
            :url="logoUrl"
            class="size-5 shrink-0"
          />
          <span class="whitespace-nowrap max-lg:hidden">{{ name }}</span>
          <span class="text-muted max-lg:hidden">·</span>
          <span class="truncate">{{ branch?.name ?? 'Branch' }}</span>
        </p>
        <UBadge
          v-if="openNow && pausedUntil"
          label="Paused"
          color="warning"
          variant="subtle"
          icon="i-lucide-pause"
          class="shrink-0"
          :ui="{ label: 'max-sm:sr-only' }"
        />
        <UBadge
          v-else-if="openNow !== null"
          :label="openNow ? 'Open' : 'Closed'"
          :color="openNow ? 'success' : 'neutral'"
          variant="subtle"
          class="shrink-0 max-sm:hidden"
        />
      </div>
      <div class="ms-auto" />
      <UInput
        v-if="search !== undefined"
        ref="searchInput"
        v-model="search"
        icon="i-lucide-search"
        placeholder="Order number"
        aria-label="Search orders by number or name"
        class="order-last w-full sm:order-0 sm:w-auto sm:min-w-0 sm:max-w-72 sm:flex-1"
        :ui="{ trailing: 'pe-1' }"
      >
        <template #trailing>
          <UKbd
            v-if="!search"
            value="/"
          />
          <UButton
            v-else
            color="neutral"
            variant="link"
            size="sm"
            icon="i-lucide-x"
            aria-label="Clear search"
            @click="search = ''"
          />
        </template>
      </UInput>
      <UButton
        v-if="soldOutTo"
        :to="soldOutTo"
        icon="i-lucide-ban"
        label="Sold out"
        color="neutral"
        variant="outline"
        :ui="{ label: 'max-lg:sr-only' }"
      />
      <UDropdownMenu
        v-if="manage.length"
        :items="manage"
        :content="{ align: 'end' }"
      >
        <UButton
          icon="i-lucide-settings-2"
          label="Manage"
          color="neutral"
          variant="outline"
          :ui="{ label: 'max-lg:sr-only' }"
        />
      </UDropdownMenu>
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
          :aria-label="`${initials}, account: ${user?.name || user?.email}`"
        />
      </UDropdownMenu>
    </div>
  </header>
</template>
