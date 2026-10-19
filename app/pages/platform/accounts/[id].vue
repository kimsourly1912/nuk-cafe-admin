<script setup lang="ts">
import AccountDetailPage from '~/features/platform/components/AccountDetailPage.vue'

definePageMeta({ layout: 'platform', title: 'Account' })

const route = useRoute()
const id = computed(() => String(route.params.id))
</script>

<template>
  <AccountDetailPage
    :id="id"
    :key="id"
  />
</template>
