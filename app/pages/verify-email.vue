<script setup lang="ts">
import VerifyEmailPage from '~/features/account/components/VerifyEmailPage.vue'

definePageMeta({ layout: 'account', title: 'Check your email' })
useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <VerifyEmailPage />
</template>
