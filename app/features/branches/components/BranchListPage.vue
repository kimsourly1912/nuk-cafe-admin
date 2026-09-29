<script setup lang="ts">
/**
 * `/branches` (D91): opens the only branch at once (launch has one), or lists them when there are
 * several (staging has a second test branch). Branches are created by the seed task, not here.
 */
import { useBranchOptions } from '../composables/useBranches'

const { data: branches, loading, error, refresh } = useBranchOptions()

// One branch: its page is the Branch page (replace, so Back doesn't return here).
watch(branches, (list) => {
  if (list?.length === 1) navigateTo(`/branches/${list[0]!.id}`, { replace: true })
}, { immediate: true })
</script>

<template>
  <UDashboardPanel id="branches">
    <template #header>
      <UDashboardNavbar title="Branches">
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
        v-else-if="loading || branches?.length === 1"
        label="Loading branches…"
      />
      <ListEmptyState
        v-else-if="!branches?.length"
        noun="branches"
        :filtered="false"
      />
      <ul
        v-else
        aria-label="Branches"
        class="divide-y divide-default rounded-lg border border-default"
      >
        <li
          v-for="branch in branches"
          :key="branch.id"
          class="p-1"
        >
          <UButton
            :to="`/branches/${branch.id}`"
            :label="branch.name"
            icon="i-lucide-map-pin"
            trailing-icon="i-lucide-chevron-right"
            color="neutral"
            variant="ghost"
            block
            class="justify-start"
            :ui="{ trailingIcon: 'ms-auto' }"
          />
        </li>
      </ul>
    </template>
  </UDashboardPanel>
</template>
