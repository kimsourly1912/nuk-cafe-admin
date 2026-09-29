<script setup lang="ts">
import ForgotPasswordPage from '~/features/account/components/ForgotPasswordPage.vue'

definePageMeta({ layout: 'account', title: 'Reset your password' })
useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <ForgotPasswordPage />
</template>
