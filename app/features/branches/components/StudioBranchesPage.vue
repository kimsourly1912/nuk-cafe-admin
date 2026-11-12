<script setup lang="ts">
import { useBranchOptions } from '../composables/useBranchOptions'

const tenantPath = useTenantPath()
const { data: branches, error, refresh } = useBranchOptions()

watch(branches, (list) => {
  if (list?.length === 1) navigateTo(tenantPath(`/admin/studio/${list[0]!.id}`), { replace: true })
}, { immediate: true })
</script>

<template>
  <UDashboardPanel id="studio-branches">
    <template #header>
      <UDashboardNavbar title="Studio">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load the branches"
        @retry="refresh()"
      />
      <ListSkeleton
        v-else-if="!branches || branches.length === 1"
        label="Opening Studio…"
        variant="card"
      />
      <ListEmptyState
        v-else-if="!branches.length"
        noun="branches"
        :filtered="false"
      />
      <ul
        v-else
        aria-label="Branch layouts"
        class="divide-y divide-default rounded-lg border border-default"
      >
        <li
          v-for="branch in branches"
          :key="branch.id"
          class="flex items-center justify-between gap-3 p-4"
        >
          <span class="min-w-0 break-words font-medium text-highlighted">{{ branch.name }}</span>
          <UButton
            :to="{ path: tenantPath(`/admin/studio/${branch.id}`), query: { from: 'picker' } }"
            :aria-label="`Open Studio for ${branch.name}`"
            label="Open Studio"
            icon="i-lucide-layout-dashboard"
            color="neutral"
            variant="outline"
          />
        </li>
      </ul>
    </template>
  </UDashboardPanel>
</template>
