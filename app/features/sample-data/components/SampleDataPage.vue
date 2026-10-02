<script setup lang="ts">
/**
 * Sample data (`/admin/sample-data`, D94, the owner's mockups): realistic test data in one click,
 * and a reset. Only where the environment turns it on (local and staging); the server refuses
 * everywhere else, and the sidebar doesn't list it. Three cards: the sample menu, branch hours and
 * tables, and the danger zone. One action runs at a time; the others wait.
 */
import { useSampleData } from '../composables/useSampleData'
import { hasResettable } from '../utils/state'
import ResetMenuModal from './ResetMenuModal.vue'
import SampleBranchCard from './SampleBranchCard.vue'
import SampleMenuCard from './SampleMenuCard.vue'

const enabled = useRuntimeConfig().public.sampleData.enabled
const { data: state, error, loading, refresh, running, menuError, branchError, loadMenu, loadBranch, resetMenu } = useSampleData()

const resetOpen = ref(false)
async function reset() {
  if (await resetMenu()) resetOpen.value = false
}
</script>

<template>
  <UDashboardPanel
    id="sample-data"
    class="page-narrow"
  >
    <template #header>
      <UDashboardNavbar title="Sample data">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <UAlert
          v-if="!enabled"
          color="neutral"
          variant="subtle"
          icon="i-lucide-shield-off"
          title="Sample data is off here"
          description="It's only available on local and staging environments."
        />
        <template v-else>
          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            :title="state ? `You're on ${state.environment}` : 'Test data'"
            description="Realistic cafe data for trying the app. Only on local and staging; never available in production."
          />
          <ApiErrorAlert
            v-if="error"
            :error="error"
            title="Could not load the sample data state"
            @retry="refresh()"
          />
          <div
            v-else-if="loading || !state"
            class="space-y-4"
          >
            <USkeleton
              v-for="n in 3"
              :key="n"
              class="h-48"
            />
          </div>
          <template v-else>
            <SampleMenuCard
              :state="state"
              :loading="running === 'menu'"
              :busy="!!running && running !== 'menu'"
              :error="menuError"
              @load="loadMenu"
            />
            <SampleBranchCard
              :state="state"
              :loading="running === 'branch'"
              :busy="!!running && running !== 'branch'"
              :error="branchError"
              @load="loadBranch"
            />
            <UCard
              as="section"
              aria-labelledby="danger-zone"
              :ui="{ root: 'ring-error/50 bg-error/5' }"
            >
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="space-y-1">
                  <p class="text-xs font-semibold uppercase text-error">
                    Danger zone
                  </p>
                  <h2
                    id="danger-zone"
                    class="text-lg font-semibold text-highlighted"
                  >
                    Reset menu data
                  </h2>
                  <p class="text-sm text-muted">
                    Permanently deletes every category, item, option set, add-on group, availability rule, sold-out switch and uploaded photo. Branches, hours, tables, staff and accounts are kept.
                  </p>
                </div>
                <div class="flex shrink-0 flex-col items-stretch gap-1 sm:items-end">
                  <UButton
                    label="Reset menu data…"
                    color="error"
                    variant="outline"
                    icon="i-lucide-trash-2"
                    class="justify-center"
                    :disabled="!!running || !hasResettable(state)"
                    @click="resetOpen = true"
                  />
                  <p
                    v-if="running === 'menu' || running === 'branch'"
                    class="text-center text-xs text-muted"
                  >
                    Available after loading finishes
                  </p>
                  <p
                    v-else-if="!hasResettable(state)"
                    class="text-center text-xs text-muted"
                  >
                    Nothing to reset
                  </p>
                </div>
              </div>
            </UCard>
            <ResetMenuModal
              v-model:open="resetOpen"
              :state="state"
              :resetting="running === 'reset'"
              @reset="reset"
            />
          </template>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
