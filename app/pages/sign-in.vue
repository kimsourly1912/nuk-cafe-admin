<script setup lang="ts">
import SignInPage from '~/features/account/components/SignInPage.vue'

definePageMeta({ layout: 'account', title: 'Sign in' })
useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <SignInPage />
</template>
