<script setup lang="ts">
import GoogleSignInResultPage from '~/features/account/components/GoogleSignInResultPage.vue'

definePageMeta({ layout: false, title: 'Google sign-in' })
useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <GoogleSignInResultPage />
</template>
