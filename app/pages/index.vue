<script setup lang="ts">
import { useAuth } from '~/features/auth'

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
        Welcome back, {{ user?.displayName || user?.username }}.
      </p>
    </template>
  </UDashboardPanel>
</template>
