<script setup lang="ts">
import LoginPage from '~/features/auth/components/LoginPage.vue'

definePageMeta({ layout: 'auth', public: true, title: 'Sign in' })
</script>

<template>
  <LoginPage />
</template>
