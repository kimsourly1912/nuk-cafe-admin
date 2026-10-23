<script setup lang="ts">
/**
 * A manager's dining tables on the counter (`/counter/<branchId>/tables`, D198): the Branch page's
 * Dining tables tab for the branch in the path, on the counter's API (`table: ['manage']` there,
 * `table: ['rotateQr']` for a new QR). Add, edit, archive and restore tables, show and download
 * their QR codes. Staff who open the address get the server's refusal.
 */
import BranchTablesTab from './BranchTablesTab.vue'

const tenantPath = useTenantPath()
const branchId = String(useRoute().params.branchId ?? '')
const tablesTab = useTemplateRef('tablesTab')

useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <UDashboardPanel
    id="counter-tables"
    class="page-narrow"
  >
    <template #header>
      <UDashboardNavbar
        title="Dining tables"
        :toggle="false"
      >
        <template #leading>
          <UButton
            :to="tenantPath(`/counter/${branchId}`)"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            aria-label="Back to queue"
          />
        </template>
        <template #right>
          <UTooltip
            text="New table"
            :kbds="['n']"
          >
            <UButton
              label="New table"
              icon="i-lucide-plus"
              @click="tablesTab?.openNew()"
            />
          </UTooltip>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <BranchTablesTab
        ref="tablesTab"
        :branch-id="branchId"
        surface="counter"
      />
    </template>
  </UDashboardPanel>
</template>
