<script setup lang="ts">
import BranchPage from '~/features/branches/components/BranchPage.vue'

definePageMeta({
  title: 'Branch',
  permission: 'branch:read',
  middleware: (to) => {
    if (to.query.tab !== 'tables' || (to.query.view !== 'design' && to.query.view !== '3d')) return
    const { tab: _tab, view, ...query } = to.query
    return navigateTo({
      path: tenantUrl(String(to.params.slug), `/admin/studio/${to.params.id}`),
      query: { ...query, ...(view === '3d' ? { view } : {}), from: 'tables' },
    }, { replace: true })
  },
})

const route = useRoute()
const id = computed(() => String(route.params.id))
</script>

<template>
  <BranchPage
    :id="id"
    :key="id"
  />
</template>
