<script setup lang="ts">
defineProps<{ status?: Status }>()
</script>

<template>
  <UBadge
    v-if="status"
    :label="STATUS_LABELS[status]"
    :color="status === 'ACTIVE' ? 'success' : 'neutral'"
    variant="subtle"
  />
</template>
