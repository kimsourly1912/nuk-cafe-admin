<script setup lang="ts">
import StaffListPage from '~/features/staff/components/StaffListPage.vue'

definePageMeta({ title: 'Staff', permission: 'staff:read' })
</script>

<template>
  <StaffListPage />
</template>
