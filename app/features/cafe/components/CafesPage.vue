<script setup lang="ts">
/**
 * Your cafes (`/cafes`, T2c, D144): the cafes the signed-in account works in, each with the
 * workspaces it may open there (Admin for an owner, Counter for an owner or branch staff). A
 * paused cafe is listed without them. Each one opens as a full page load (D141). Signed out, it
 * sends the person to sign in and back. A task-flow page (page-patterns §5): a card from `sm`, the
 * whole screen on phones.
 */
import type { Workspace } from '#shared/contracts/account'
import { useAccountCafes } from '../composables/useAccountCafes'

const { data: cafes, error, loading, refresh } = useAccountCafes()
const signedOut = computed(() => error.value?.kind === 'unauthorized')
watch(signedOut, (out) => {
  if (out) void navigateTo({ path: '/sign-in', query: { redirect: CAFES_PATH } }, { replace: true })
}, { immediate: true })

const WORKSPACES: { workspace: Workspace, label: string, icon: string }[] = [
  { workspace: 'admin', label: 'Admin', icon: 'i-lucide-layout-dashboard' },
  { workspace: 'counter', label: 'Counter', icon: 'i-lucide-receipt' },
]
const menu = tenantUrl(useRuntimeConfig().public.defaultTenant, '/')
</script>

<template>
  <TaskFrame>
    <template #header>
      <h1 class="text-lg font-semibold text-highlighted">
        Your cafes
      </h1>
      <p class="text-sm text-muted">
        Choose where to work.
      </p>
    </template>

    <ListSkeleton
      v-if="loading || signedOut"
      label="Loading your cafes…"
      variant="row"
      :count="2"
    />
    <ApiErrorAlert
      v-else-if="error"
      :error="error"
      title="Could not load your cafes"
      @retry="refresh()"
    />
    <div
      v-else-if="!cafes?.length"
      class="flex flex-col items-center gap-2 py-6 text-center"
    >
      <UIcon
        name="i-lucide-store"
        class="size-10 text-dimmed"
      />
      <p class="font-medium text-highlighted">
        This account doesn't work at a cafe
      </p>
      <p class="text-sm text-muted">
        Sign in with the account your cafe's owner added, or ask them to add you.
      </p>
      <UButton
        label="Go to the menu"
        :to="menu"
        color="neutral"
        variant="outline"
        class="mt-2"
      />
    </div>
    <ul
      v-else
      class="divide-y divide-default"
      aria-label="Your cafes"
    >
      <li
        v-for="cafe in cafes"
        :key="cafe.slug"
        class="space-y-3 py-4 first:pt-0 last:pb-0"
      >
        <div class="flex min-w-0 items-center gap-3">
          <CafeLogo
            :url="cafe.logoUrl"
            class="size-10"
          />
          <div class="min-w-0">
            <p class="flex items-center gap-2 font-medium text-highlighted">
              <span class="truncate">{{ cafe.name }}</span>
              <UBadge
                v-if="cafe.status === 'suspended'"
                label="Paused"
                color="warning"
                variant="subtle"
                size="sm"
              />
            </p>
            <p class="truncate text-sm text-muted">
              /c/{{ cafe.slug }}
            </p>
          </div>
        </div>
        <p
          v-if="cafe.status === 'suspended'"
          class="text-sm text-muted"
        >
          Paused by the platform team: its admin and counter are closed for now.
        </p>
        <div
          v-else
          class="grid auto-cols-fr grid-flow-col gap-2"
        >
          <template
            v-for="entry in WORKSPACES"
            :key="entry.workspace"
          >
            <UButton
              v-if="cafe.workspaces.includes(entry.workspace)"
              :label="entry.label"
              :icon="entry.icon"
              :to="workspaceUrl(cafe.slug, entry.workspace)"
              external
              :color="entry.workspace === 'admin' ? 'primary' : 'neutral'"
              :variant="entry.workspace === 'admin' ? 'solid' : 'outline'"
              :aria-label="`${entry.label}, ${cafe.name}`"
              block
            />
          </template>
        </div>
      </li>
    </ul>
  </TaskFrame>
</template>
