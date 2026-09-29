<script setup lang="ts">
import EmailVerifiedPage from '~/features/account/components/EmailVerifiedPage.vue'

definePageMeta({ layout: 'account', title: 'Email verified' })
useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <EmailVerifiedPage />
</template>
