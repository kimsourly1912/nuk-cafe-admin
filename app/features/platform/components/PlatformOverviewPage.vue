<script setup lang="ts">
/**
 * The console's Overview (`/platform`, step P3, D191): how many cafes there are and how they're
 * doing, counts only (D186: never a cafe's contents). What needs the platform team links to the
 * list that shows it.
 */
import { pluralize } from '~/utils/text'
import { usePlatformOverview } from '../composables/useActivity'
import { ACTIVITY_PATH, CAFES_PATH } from '../composables/usePlatformSession'

const { data: overview, loading, error, refresh } = usePlatformOverview()

/** Counts that ask for someone on the platform team, with where to look. */
const attention = computed(() => {
  const counts = overview.value
  if (!counts) return []
  return [
    { count: counts.noActiveOwner, text: `${pluralize(counts.noActiveOwner, ['cafe', 'cafes'])} without an owner who can sign in`, to: `${CAFES_PATH}?owner=none`, icon: 'i-lucide-user-x' },
    { count: counts.cafes.suspended, text: `${pluralize(counts.cafes.suspended, ['cafe', 'cafes'])} paused`, to: `${CAFES_PATH}?status=suspended`, icon: 'i-lucide-circle-pause' },
    { count: counts.bannedAccounts, text: `${pluralize(counts.bannedAccounts, ['account', 'accounts'])} banned`, to: '/platform/accounts?kind=banned', icon: 'i-lucide-ban' },
  ].filter(item => item.count > 0)
})
</script>

<template>
  <UDashboardPanel id="overview">
    <template #header>
      <UDashboardNavbar title="Overview">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load the overview"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading || !overview"
        label="Loading the overview…"
        variant="row"
      />

      <div
        v-else
        class="space-y-6"
      >
        <section aria-labelledby="overview-cafes">
          <h2
            id="overview-cafes"
            class="mb-3 font-semibold text-highlighted"
          >
            Cafes
          </h2>
          <dl class="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard
              label="Active"
              :value="String(overview.cafes.active)"
              icon="i-lucide-store"
            />
            <StatCard
              label="Paused"
              :value="String(overview.cafes.suspended)"
              icon="i-lucide-circle-pause"
            />
            <StatCard
              label="New this month"
              :value="String(overview.newCafesThisMonth)"
              icon="i-lucide-sparkles"
            />
            <StatCard
              label="No order in 7 days"
              :value="String(overview.quietCafes)"
              icon="i-lucide-clock"
            />
            <StatCard
              label="No active owner"
              :value="String(overview.noActiveOwner)"
              icon="i-lucide-user-x"
            />
          </dl>
          <p class="mt-2 text-sm text-muted">
            "No order in 7 days" counts active cafes only. The month starts in {{ overview.timeZone }}.
          </p>
        </section>

        <section aria-labelledby="overview-accounts">
          <h2
            id="overview-accounts"
            class="mb-3 font-semibold text-highlighted"
          >
            Accounts
          </h2>
          <dl class="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard
              label="Banned"
              :value="String(overview.bannedAccounts)"
              icon="i-lucide-ban"
            />
          </dl>
        </section>

        <UCard variant="outline">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Needs attention
            </h2>
          </template>
          <ul
            v-if="attention.length"
            class="divide-y divide-default"
          >
            <li
              v-for="item in attention"
              :key="item.to"
              class="py-1 first:pt-0 last:pb-0"
            >
              <UButton
                :to="item.to"
                :icon="item.icon"
                trailing-icon="i-lucide-chevron-right"
                color="neutral"
                variant="ghost"
                block
                class="justify-start"
                :ui="{ trailingIcon: 'ms-auto' }"
              >
                {{ item.text }}
              </UButton>
            </li>
          </ul>
          <p
            v-else
            class="text-sm text-muted"
          >
            Nothing needs the platform team right now.
          </p>
          <template #footer>
            <UButton
              label="See the platform's activity"
              :to="ACTIVITY_PATH"
              color="neutral"
              variant="link"
              class="px-0"
            />
          </template>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
