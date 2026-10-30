<script setup lang="ts">
import AvailabilityRuleListPage from '~/features/availability-rules/components/AvailabilityRuleListPage.vue'

definePageMeta({ title: 'Availability', permission: 'menu:read' })
</script>

<template>
  <AvailabilityRuleListPage />
</template>
