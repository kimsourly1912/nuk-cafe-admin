<script setup lang="ts">
import { useAuth } from '~/features/auth'

definePageMeta({ title: 'Dashboard' })

const { user } = useAuth()
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar title="Dashboard">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <p class="text-muted">
        Welcome back, {{ user?.name || user?.email }}.
      </p>
    </template>
  </UDashboardPanel>
</template>
