<script setup lang="ts">
/**
 * Sold out (`/counter/<branchId>/sold-out`, step 6.3c, D105, the owner's frame): switch off what's
 * run out, one version at a time ("Iced Latte · Large"). It stays off until someone switches it
 * back (Q37, owner 2026-09-30), so the title is "Sold out", not "Sold out today". The switch reads
 * "Available" or "Sold out" as it is; a sold-out row says since when and by whom. Search, the
 * menu's categories as tabs (chips that scroll on phones), and "N sold out" to show only those. The
 * customer menu shows the change on its next load.
 */
import { useLocalStorage } from '@vueuse/core'
import type { PublicBranch } from '#shared/contracts/branches'
import { useCounterSession } from '../composables/useCounterSession'
import { useSoldOut } from '../composables/useSoldOut'
import { clockTime } from '../utils/counter'
import { filterSoldOutRows, rowName, soldOutCategories } from '../utils/sold-out'
import type { SoldOutRow } from '../utils/sold-out'
import CounterHeader from './CounterHeader.vue'

const tenantPath = useTenantPath()

const route = useRoute()
const branchId = computed(() => String(route.params.branchId ?? ''))
const { user } = useCounterSession()
const branch = computed(() => user.value?.branches.find(b => b.id === branchId.value) ?? null)
const status = useApiQuery('counter:branch-status', () => apiFetch<PublicBranch[]>('/public/branches'), { server: false })
const branchStatus = computed(() => status.data.value?.find(b => b.id === branchId.value) ?? null)

const { rows, set, error, refresh } = useSoldOut(branchId)

const search = ref('')
const category = ref('all')
const onlySoldOut = ref(false)
// Switched back on while showing only the sold-out ones: kept in view until the filter changes.
const keep = ref(new Set<string>())
watch([search, category, onlySoldOut], () => {
  keep.value = new Set()
})
const categories = computed(() => [{ id: 'all', name: 'All' }, ...soldOutCategories(rows.value ?? [])])
const shown = computed(() => filterSoldOutRows(rows.value ?? [], { search: search.value, category: category.value, onlySoldOut: onlySoldOut.value, keep: keep.value }))
const soldOutCount = computed(() => (rows.value ?? []).filter(row => row.soldOut).length)

// The queue's new-order chime setting, kept in this browser (useCounterQueue).
function setAvailable(row: SoldOutRow, available: boolean) {
  if (available && onlySoldOut.value) keep.value = new Set([...keep.value, row.variationId])
  set.execute({ row, soldOut: !available })
}

const muted = useLocalStorage('counter:muted', false, { initOnMounted: true })

useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <CounterHeader
      v-model:muted="muted"
      :branch-name="branch?.name ?? 'Branch'"
      :open-now="branchStatus ? branchStatus.openNow : null"
    />

    <main class="mx-auto w-full max-w-5xl flex-1 space-y-4 p-4">
      <UButton
        :to="tenantPath(`/counter/${branchId}`)"
        label="Back to queue"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="link"
        class="-ms-2.5"
      />
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold text-highlighted">
            Sold out
          </h1>
          <p class="text-sm text-muted">
            Switch off what's run out. It stays off until you switch it back.
          </p>
        </div>
        <UButton
          :label="`${soldOutCount} sold out`"
          :color="onlySoldOut ? 'error' : 'neutral'"
          :variant="onlySoldOut ? 'soft' : 'outline'"
          icon="i-lucide-ban"
          :aria-pressed="onlySoldOut"
          :disabled="!rows"
          @click="onlySoldOut = !onlySoldOut"
        />
      </div>

      <ApiErrorAlert
        v-if="error && !rows"
        :error="error"
        title="Couldn't load the menu"
        @retry="refresh()"
      />
      <template v-else>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            placeholder="Find an item"
            aria-label="Find an item"
            class="sm:w-72"
          />
          <nav
            class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
            aria-label="Categories"
          >
            <UButton
              v-for="c in categories"
              :key="c.id"
              :label="c.name"
              size="sm"
              :color="category === c.id ? 'primary' : 'neutral'"
              :variant="category === c.id ? 'soft' : 'ghost'"
              :aria-pressed="category === c.id"
              class="shrink-0"
              @click="category = c.id"
            />
          </nav>
        </div>

        <div
          v-if="!rows"
          class="space-y-2"
          aria-busy="true"
          aria-label="Loading the menu"
        >
          <USkeleton
            v-for="n in 6"
            :key="n"
            class="h-14 w-full"
          />
        </div>

        <UCard
          v-else
          :ui="{ body: 'p-0 sm:p-0' }"
        >
          <ul
            class="divide-y divide-default"
            aria-label="Menu items"
          >
            <li
              v-for="row in shown"
              :key="row.variationId"
              class="flex items-center gap-3 px-4 py-3"
              :aria-label="rowName(row)"
            >
              <div class="min-w-0 flex-1">
                <p
                  class="font-medium"
                  :class="row.soldOut ? 'text-muted' : 'text-highlighted'"
                >
                  {{ rowName(row) }}
                </p>
                <p
                  v-if="row.soldOut && row.since"
                  class="text-sm text-muted"
                >
                  Since {{ clockTime(row.since) }}{{ row.by ? ` by ${row.by}` : '' }}
                </p>
              </div>
              <span class="w-28 shrink-0 text-sm text-muted max-sm:hidden">{{ row.categoryName }}</span>
              <UBadge
                v-if="row.soldOut"
                label="Sold out"
                color="error"
                variant="subtle"
                class="shrink-0"
              />
              <USwitch
                :model-value="!row.soldOut"
                :label="row.soldOut ? 'Sold out' : 'Available'"
                :loading="set.isPending(row.variationId)"
                :disabled="set.isPending(row.variationId)"
                :aria-label="`${rowName(row)}: available`"
                :ui="{ label: 'max-sm:sr-only w-20' }"
                class="shrink-0"
                @update:model-value="value => setAvailable(row, value)"
              />
            </li>
            <li
              v-if="!shown.length"
              class="px-4 py-10 text-center text-sm text-muted"
            >
              {{ onlySoldOut && !search.trim() ? 'Nothing is sold out.' : 'No items match.' }}
            </li>
          </ul>
        </UCard>
        <p class="text-sm text-muted">
          Customers see the change the next time their menu loads.
        </p>
      </template>
    </main>
  </div>
</template>
