<script setup lang="ts">
import CounterSignInPage from '~/features/counter/components/CounterSignInPage.vue'

definePageMeta({ layout: 'auth', public: true, title: 'Sign in' })
</script>

<template>
  <CounterSignInPage />
</template>
