<script setup lang="ts">
import PaymentsPage from '~/features/exchange-rates/components/PaymentsPage.vue'

definePageMeta({ title: 'Payments', permission: 'settings:manage' })
</script>

<template>
  <PaymentsPage />
</template>
