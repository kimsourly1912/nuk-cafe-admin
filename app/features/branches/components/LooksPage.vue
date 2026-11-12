<script setup lang="ts">
/**
 * `/admin/branches/looks` (D273, step 3d): every furniture look in one place, outside the editor.
 * The built-in looks and pieces with their pictures (start a new look from one), and the cafe's
 * own table, chair and fixture looks: edit, start another from one, or delete one no saved layout
 * uses. Looks are cafe-wide, so this page belongs to no branch. Owners only (`furniture:manage`).
 * Studio shows the same list in its Manage looks panel (D277).
 */
import { useLookCatalog } from '../composables/useLookCatalog'
import LooksLibrary from './LooksLibrary.vue'

const tenantPath = useTenantPath()
const catalog = useLookCatalog()
</script>

<template>
  <UDashboardPanel id="furniture-looks">
    <template #header>
      <UDashboardNavbar title="Furniture looks">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UDropdownMenu
            :items="catalog.newItems.value"
            :content="{ align: 'end' }"
          >
            <UButton
              label="New look"
              icon="i-lucide-plus"
              trailing-icon="i-lucide-chevron-down"
              :disabled="catalog.loading.value || Boolean(catalog.error.value)"
            />
          </UDropdownMenu>
        </template>
      </UDashboardNavbar>
      <RefreshBar :active="catalog.refreshing.value" />
    </template>

    <template #body>
      <LooksLibrary :catalog="catalog">
        <template #intro>
          Place them in a branch’s
          <ULink
            :to="tenantPath('/admin/studio')"
            class="text-primary"
          >Studio</ULink>.
        </template>
      </LooksLibrary>
    </template>
  </UDashboardPanel>
</template>
