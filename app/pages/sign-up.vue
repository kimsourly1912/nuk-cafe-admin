<script setup lang="ts">
import SignUpPage from '~/features/account/components/SignUpPage.vue'

definePageMeta({ layout: 'account', title: 'Create account' })
useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <SignUpPage />
</template>
