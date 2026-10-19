<script setup lang="ts">
import * as v from 'valibot'
import { accountIdSchema } from '#shared/contracts/tenants'
import CafeCreatePage from '~/features/platform/components/CafeCreatePage.vue'

definePageMeta({ layout: 'platform', title: 'New cafe' })

// `?owner=<account id>` (New cafe for this owner): a valid id or nothing; the page reads the account itself.
const route = useRoute()
const ownerId = computed(() => {
  const parsed = v.safeParse(accountIdSchema, route.query.owner)
  return parsed.success ? parsed.output : undefined
})
</script>

<template>
  <CafeCreatePage
    :key="ownerId ?? 'new'"
    :owner-id="ownerId"
  />
</template>
