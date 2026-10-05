<script setup lang="ts">
import { useAssistantImportStatus } from '../composables/useAssistantImportStatus'

const status = useAssistantImportStatus()
const tenantPath = useTenantPath()
</script>

<template>
  <UButton
    v-if="status.data.value?.enabled"
    aria-label="Import menu"
    icon="i-lucide-file-up"
    color="neutral"
    variant="outline"
    :to="tenantPath('/admin/products/import')"
  >
    <span class="hidden sm:inline">Import menu</span>
  </UButton>
</template>
