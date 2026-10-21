<script setup lang="ts">
/**
 * Activity (`/platform/activity`, step P3, D191): what the platform team did, newest first, from
 * the audit rows the console writes; never a cafe's own staff's rows. Filters by who, what and when
 * live in the URL; a cafe's page opens it filtered to that cafe (`?tenantId=`), shown as a chip to
 * clear. A table from `sm`, rows on phones (page-patterns §2).
 */
import type { SelectItem, TableColumn } from '@nuxt/ui'
import type { ActivityEntry, PlatformAction } from '#shared/contracts/platform-activity'
import { PLATFORM_ACTIONS } from '#shared/contracts/platform-activity'
import { useActivityCafe, useActivityList, useSuperadmins } from '../composables/useActivity'
import { accountPath } from '../composables/useAccounts'
import { CAFES_PATH } from '../composables/usePlatformSession'
import type { ActivityPeriod } from '../schemas/activity'
import { ACTION_LABELS, ACTIVITY_PERIODS, activitySubject, actorName, periodDates } from '../schemas/activity'

const { isCompact } = useLayoutContext()
const timeZone = useRuntimeConfig().public.cafeTimeZone

const { page, pageSize, filters, isFiltered, clearFilters } = usePaginatedQuery({
  actorId: ANY as string,
  action: ANY as PlatformAction | Any,
  period: 'any' as ActivityPeriod,
  tenantId: ANY as string,
})
const query = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  ...(filters.actorId !== ANY ? { actorId: filters.actorId } : {}),
  ...(filters.action !== ANY ? { action: filters.action } : {}),
  ...(filters.tenantId !== ANY ? { tenantId: filters.tenantId } : {}),
  ...periodDates(filters.period, timeZone),
}))

const { data, loading, refreshing, error, refresh } = useActivityList(query)
const rows = computed(() => data.value?.items ?? [])
watch(() => data.value?.totalPages, (totalPages) => {
  if (totalPages !== undefined && page.value > Math.max(totalPages, 1)) page.value = Math.max(totalPages, 1)
})

const superadmins = useSuperadmins()
const actorItems = computed<SelectItem[]>(() => [
  { label: 'Anyone', value: ANY },
  ...(superadmins.data.value?.items ?? []).map(account => ({ label: account.name, value: account.id })),
])
const actionItems: SelectItem[] = [{ label: 'Any action', value: ANY }, ...PLATFORM_ACTIONS.map(action => ({ label: ACTION_LABELS[action], value: action }))]
const periodItems: SelectItem[] = ACTIVITY_PERIODS.map(period => ({ label: period.label, value: period.value }))

// The cafe the list is filtered to, by name.
const filteredCafe = useActivityCafe(() => (filters.tenantId === ANY ? undefined : filters.tenantId))
const cafeName = computed(() => filteredCafe.data.value?.name ?? 'One cafe')

const columns: TableColumn<ActivityEntry>[] = [
  { id: 'at', header: 'When' },
  { id: 'what', header: 'What' },
  { id: 'cafe', header: 'Cafe' },
  { id: 'who', header: 'Who' },
]
</script>

<template>
  <UDashboardPanel id="activity">
    <template #header>
      <UDashboardNavbar title="Activity">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <USelect
            v-model="filters.actorId"
            :items="actorItems"
            aria-label="Who"
            class="min-w-0 flex-1 sm:w-40 sm:flex-none"
          />
          <USelect
            v-model="filters.action"
            :items="actionItems"
            aria-label="Action"
            class="min-w-0 flex-1 sm:w-52 sm:flex-none"
          />
          <USelect
            v-model="filters.period"
            :items="periodItems"
            aria-label="When"
            class="min-w-0 flex-1 sm:w-36 sm:flex-none"
          />
          <UBadge
            v-if="filters.tenantId !== ANY"
            color="neutral"
            variant="subtle"
            size="lg"
            class="gap-1"
          >
            {{ cafeName }}
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="link"
              size="xs"
              :aria-label="`Show every cafe, not only ${cafeName}`"
              class="p-0"
              @click="filters.tenantId = ANY"
            />
          </UBadge>
          <UIcon
            v-if="refreshing"
            name="i-lucide-loader-circle"
            class="size-4 animate-spin text-muted"
          />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <p class="text-sm text-muted">
        What the platform team did: cafes, owners, notes and accounts. A cafe's own staff's changes aren't listed here.
      </p>

      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load the activity"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading"
        label="Loading the activity…"
      />

      <ListEmptyState
        v-else-if="!rows.length"
        noun="activity"
        :filtered="isFiltered"
        @clear="clearFilters()"
      />

      <!-- Phones: one entry per row (page-patterns §2) -->
      <ul
        v-else-if="isCompact"
        aria-label="Activity"
        class="divide-y divide-default rounded-lg border border-default"
      >
        <li
          v-for="entry in rows"
          :key="entry.id"
          class="space-y-0.5 p-3 text-sm"
        >
          <p class="font-medium text-highlighted">
            {{ ACTION_LABELS[entry.action] }}
            <template v-if="entry.cafe">
              · <NuxtLink
                :to="`${CAFES_PATH}/${entry.cafe.id}`"
                class="underline"
              >{{ entry.cafe.name }}</NuxtLink>
            </template>
          </p>
          <p
            v-if="activitySubject(entry)"
            class="text-default"
          >
            {{ activitySubject(entry) }}
          </p>
          <p
            v-if="entry.details.reason"
            class="break-words text-muted"
          >
            Reason: {{ entry.details.reason }}
          </p>
          <p class="text-muted">
            {{ actorName(entry) }} · {{ formatDateTime(entry.at) }}
          </p>
        </li>
      </ul>

      <UTable
        v-else
        :data="rows"
        :columns="columns"
        class="shrink-0"
      >
        <template #at-cell="{ row }">
          <span class="whitespace-nowrap text-muted">{{ formatDateTime(row.original.at) }}</span>
        </template>
        <template #what-cell="{ row }">
          <div class="min-w-0 max-w-md whitespace-normal">
            <p class="font-medium text-highlighted">
              {{ ACTION_LABELS[row.original.action] }}
            </p>
            <p
              v-if="activitySubject(row.original)"
              class="text-default"
            >
              <NuxtLink
                v-if="row.original.account && row.original.action.startsWith('platform.account.')"
                :to="accountPath(row.original.account.id)"
                class="underline"
              >{{ activitySubject(row.original) }}</NuxtLink>
              <template v-else>
                {{ activitySubject(row.original) }}
              </template>
            </p>
            <p
              v-if="row.original.details.reason"
              class="break-words text-muted"
            >
              Reason: {{ row.original.details.reason }}
            </p>
          </div>
        </template>
        <template #cafe-cell="{ row }">
          <NuxtLink
            v-if="row.original.cafe"
            :to="`${CAFES_PATH}/${row.original.cafe.id}`"
            class="underline"
          >{{ row.original.cafe.name }}</NuxtLink>
          <span
            v-else
            class="text-muted"
          >Platform</span>
        </template>
        <template #who-cell="{ row }">
          <span class="text-muted">{{ actorName(row.original) }}</span>
        </template>
      </UTable>

      <ListPagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :total="data?.total ?? 0"
      />
    </template>
  </UDashboardPanel>
</template>
