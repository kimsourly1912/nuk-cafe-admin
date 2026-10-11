<script setup lang="ts">
/**
 * Promotions (`/admin/promotions`, M1, D163): every promotion as a card with its poster, loaded
 * whole (a cafe runs a handful at a time), so search and the phase tabs work here. Live first: the
 * tab a cafe checks most. A promotion opens on its own page; New promotion opens the editor.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Promotion, PromotionPhase } from '#shared/contracts/menu-promotions'
import { usePromotionList, usePromotionMutations } from '../composables/usePromotions'
import { localToday } from '../schemas/promotion-form'
import PromotionCard from './PromotionCard.vue'

const tenantPath = useTenantPath()

const TABS: { label: string, value: PromotionPhase }[] = [
  { label: 'Live', value: 'live' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Drafts', value: 'draft' },
  { label: 'Ended', value: 'ended' },
]
/** Live, scheduled, drafts, then ended: what's running comes first under "All". */
const ORDER: Record<PromotionPhase, number> = { live: 0, scheduled: 1, draft: 2, ended: 3 }

const { filters, isFiltered, clearFilters } = usePaginatedQuery({
  search: '',
  status: ANY as string,
})

const { data, loading, refreshing, error, refresh } = usePromotionList()
const { publish, end, remove, isBusy } = usePromotionMutations()
const today = localToday()

const matching = computed(() => {
  const term = filters.search.trim().toLocaleLowerCase()
  return (data.value ?? [])
    .filter(p => !term || p.name.toLocaleLowerCase().includes(term) || p.items.some(i => i.name.toLocaleLowerCase().includes(term)) || p.categories.some(c => c.name.toLocaleLowerCase().includes(term)))
    .sort((a, b) => ORDER[a.phase] - ORDER[b.phase])
})
const rows = computed(() => matching.value.filter(p => filters.status === ANY || p.phase === filters.status))
const counts = computed(() => data.value && {
  all: matching.value.length,
  ...Object.fromEntries(TABS.map(tab => [tab.value, matching.value.filter(p => p.phase === tab.value).length])),
})

const newPromotion = () => navigateTo(tenantPath('/admin/promotions/new'))

function actions(promotion: Promotion): DropdownMenuItem[] {
  const edit = { label: 'Edit', icon: 'i-lucide-pencil', to: tenantPath(`/admin/promotions/${promotion.id}/edit`) }
  switch (promotion.phase) {
    case 'draft':
      return [edit, { label: 'Publish', icon: 'i-lucide-send', onSelect: () => publish.execute(promotion) }, { type: 'separator' }, { label: 'Delete draft', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => remove.execute(promotion) }]
    case 'live':
    case 'scheduled':
      return [edit, { type: 'separator' }, { label: 'End now', icon: 'i-lucide-circle-stop', color: 'error', onSelect: () => end.execute(promotion) }]
    default:
      return []
  }
}

usePageShortcuts({ n: () => newPromotion() })
</script>

<template>
  <UDashboardPanel id="promotions">
    <template #header>
      <UDashboardNavbar title="Promotions">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UTooltip
            text="New promotion"
            :kbds="['n']"
          >
            <UButton
              label="New promotion"
              icon="i-lucide-plus"
              @click="newPromotion()"
            />
          </UTooltip>
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <template #left>
          <SearchInput
            v-model="filters.search"
            placeholder="Search promotions or items…"
            class="w-full sm:w-64"
          />
          <UIcon
            v-if="refreshing"
            name="i-lucide-loader-circle"
            class="size-4 animate-spin text-muted"
          />
        </template>
      </UDashboardToolbar>
    </template>

    <template #body>
      <p class="text-sm text-muted">
        Run a discount on part of your menu or all of it. Customers see the lower price on the menu and at checkout while it runs.
      </p>

      <StatusTabs
        v-model="filters.status"
        :tabs="TABS"
        :counts="counts"
      />

      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load promotions"
        @retry="refresh()"
      />

      <ListSkeleton
        v-else-if="loading"
        label="Loading promotions…"
        variant="card"
      />

      <div
        v-else-if="!data?.length"
        class="flex flex-col items-center gap-2 py-12 text-center"
      >
        <div class="flex size-12 items-center justify-center rounded-full bg-primary/10">
          <UIcon
            name="i-lucide-badge-percent"
            class="size-6 text-primary"
          />
        </div>
        <p class="font-medium text-highlighted">
          No promotions yet
        </p>
        <p class="max-w-md text-sm text-muted">
          Take a percent or an amount off chosen items, a category or the whole menu, for the days you choose. Add a poster you made in Canva or with AI, and customers see it on the menu.
        </p>
        <UButton
          label="New promotion"
          icon="i-lucide-plus"
          class="mt-2"
          @click="newPromotion()"
        />
      </div>

      <ListEmptyState
        v-else-if="!rows.length"
        noun="promotions"
        :filtered="isFiltered"
        create-label="New promotion"
        @create="newPromotion()"
        @clear="clearFilters()"
      />

      <div
        v-else
        class="grid grid-cols-1 gap-4 lg:grid-cols-2"
      >
        <PromotionCard
          v-for="promotion in rows"
          :key="promotion.id"
          :promotion="promotion"
          :actions="actions(promotion)"
          :today="today"
          :busy="isBusy(promotion.id)"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
