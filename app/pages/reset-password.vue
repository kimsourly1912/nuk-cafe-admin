<script setup lang="ts">
import ResetPasswordPage from '~/features/account/components/ResetPasswordPage.vue'

definePageMeta({ layout: 'account', title: 'Choose a new password' })
useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <ResetPasswordPage />
</template>
