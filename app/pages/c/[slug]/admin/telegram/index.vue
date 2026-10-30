<script setup lang="ts">
import TelegramPage from '~/features/notifications/components/TelegramPage.vue'

definePageMeta({ title: 'Telegram', permission: 'settings:manage' })
</script>

<template>
  <TelegramPage />
</template>
