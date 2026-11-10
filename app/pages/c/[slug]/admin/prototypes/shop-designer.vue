<script setup lang="ts">
import ShopDesignerPrototypePage from '~/features/branches/components/ShopDesignerPrototypePage.vue'

// Like the admin's dining tables: owners (`branch: ['update']`); managers get tables on the counter (D198).
definePageMeta({ title: 'Shop designer', permission: 'branch:update' })

// The step 1 prototype (D273) exists on the dev server and staging only.
if (!useRuntimeConfig().public.shopDesignerPrototype) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
}
</script>

<template>
  <ShopDesignerPrototypePage />
</template>
