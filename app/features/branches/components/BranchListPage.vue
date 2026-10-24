<script setup lang="ts">
/**
 * `/admin/branches` (D91): opens the only branch at once (most cafes have one), or lists them when
 * there are several, with Add branch (D197; a one-branch cafe adds from the Branch page).
 */
import { useAddBranch } from '../composables/useAddBranch'
import { useBranchOptions } from '../composables/useBranchOptions'
import BranchSkeleton from './BranchSkeleton.vue'

const tenantPath = useTenantPath()

const { data: branches, loading, error, refresh } = useBranchOptions()
const route = useRoute()

// One branch: its page is the Branch page (replace, so Back doesn't return here; `?tab=` is kept).
watch(branches, (list) => {
  if (list?.length === 1) navigateTo({ path: tenantPath(`/admin/branches/${list[0]!.id}`), query: route.query }, { replace: true })
}, { immediate: true })

// Until we know there are several, this page looks like the Branch page it usually hands over to
// (no "Branches" title, the branch skeleton), so the redirect doesn't flash a list first.
const opening = computed(() => !error.value && (loading.value || branches.value?.length === 1))
const { addBranch, full, limit } = useAddBranch()
</script>

<template>
  <UDashboardPanel
    id="branches"
    class="page-narrow"
  >
    <template #header>
      <UDashboardNavbar :title="opening ? undefined : 'Branches'">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template
          v-if="!opening && !error"
          #right
        >
          <UButton
            label="Add branch"
            icon="i-lucide-plus"
            :disabled="full"
            @click="addBranch()"
          />
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
      <BranchSkeleton v-else-if="opening" />
      <ListEmptyState
        v-else-if="!branches?.length"
        noun="branches"
        :filtered="false"
      />
      <div
        v-else
        class="space-y-4"
      >
        <p class="text-sm text-muted">
          Branches are your cafe's locations. They share one menu, one staff list and the same customers; each has its own hours, tables, counter and orders.
          <template v-if="full">
            A cafe can have at most {{ limit }} branches.
          </template>
        </p>
        <ul
          aria-label="Branches"
          class="divide-y divide-default rounded-lg border border-default"
        >
          <li
            v-for="branch in branches"
            :key="branch.id"
            class="p-1"
          >
            <UButton
              :to="tenantPath(`/admin/branches/${branch.id}`)"
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
      </div>
    </template>
  </UDashboardPanel>
</template>
