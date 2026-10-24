<script setup lang="ts">
/**
 * Sold out (`/counter/<branchId>/sold-out`, step 6.3c, D105, the owner's frame): switch off what's
 * run out, one version at a time ("Iced Latte · Large"). It stays off until someone switches it
 * back (Q37, owner 2026-09-30), so the title is "Sold out", not "Sold out today". The switch reads
 * "Available" or "Sold out" as it is; a sold-out row says since when and by whom. Search and
 * "Sold out" (to show only those) on top, the menu's categories below as chips (they scroll on
 * phones). An item is a card in a grid, its versions the rows. The customer menu shows the change
 * on its next load.
 */
import { useSoldOut } from '../composables/useSoldOut'
import { filterSoldOutRows, groupSoldOutRows, rowName, soldOutCategories } from '../utils/sold-out'
import type { SoldOutRow } from '../utils/sold-out'
import CounterHeader from './CounterHeader.vue'

const tenantPath = useTenantPath()

const route = useRoute()
const branchId = computed(() => String(route.params.branchId ?? ''))

const { rows, set, toggle, error, refresh } = useSoldOut(branchId)

const search = ref('')
const category = ref('all')
const onlySoldOut = ref(false)
// Switched back on while showing only the sold-out ones: kept in view until the filter changes.
const keep = ref(new Set<string>())
watch([search, category, onlySoldOut], () => {
  keep.value = new Set()
})
// The category row scrolls without a scrollbar and the chosen category is centered, like the tab rows (D128).
const categoryRow = useTemplateRef('categoryRow')
watch(category, () => nextTick(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  categoryRow.value?.querySelector('[data-category][aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
}), { flush: 'post' })
const categories = computed(() => [{ id: 'all', name: 'All' }, ...soldOutCategories(rows.value ?? [])])
const shown = computed(() => filterSoldOutRows(rows.value ?? [], { search: search.value, category: category.value, onlySoldOut: onlySoldOut.value, keep: keep.value }))
const groups = computed(() => groupSoldOutRows(shown.value))
const soldOutIn = (rows: SoldOutRow[]) => rows.filter(row => row.soldOut).length
const stateLabel = (rows: SoldOutRow[]) => {
  const n = soldOutIn(rows)
  return n === 0 ? 'All available' : n === rows.length ? 'All sold out' : `${n} of ${rows.length} sold out`
}
const soldOutCount = computed(() => (rows.value ?? []).filter(row => row.soldOut).length)

function setAvailable(row: SoldOutRow, available: boolean) {
  if (available && onlySoldOut.value) keep.value = new Set([...keep.value, row.variationId])
  void toggle(row, !available)
}

useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <CounterHeader
      :branch-id="branchId"
      :sold-out-button="false"
    />

    <main class="mx-auto w-full max-w-7xl flex-1 space-y-4 p-4">
      <UButton
        :to="tenantPath(`/counter/${branchId}`)"
        label="Back to queue"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="link"
        class="-ms-2.5"
      />
      <div>
        <h1 class="text-2xl font-semibold text-highlighted">
          Sold out
        </h1>
        <p class="text-sm text-muted">
          Switch off what's run out. It stays off until you switch it back.
        </p>
      </div>

      <ApiErrorAlert
        v-if="error && !rows"
        :error="error"
        title="Couldn't load the menu"
        @retry="refresh()"
      />
      <template v-else>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            v-model="search"
            placeholder="Find an item"
            class="sm:w-96"
          />
          <!-- Beside the search it combines with: everything, or only what's sold out, in the chosen category. -->
          <UFieldGroup aria-label="Show">
            <UButton
              label="All items"
              :color="!onlySoldOut ? 'primary' : 'neutral'"
              variant="outline"
              :aria-pressed="!onlySoldOut"
              @click="onlySoldOut = false"
            />

            <UButton
              label="Sold out"
              :color="onlySoldOut ? 'primary' : 'neutral'"
              variant="outline"
              :aria-pressed="onlySoldOut"
              :disabled="!rows"
              @click="onlySoldOut = true"
            >
              <template #trailing>
                <UBadge
                  :label="String(soldOutCount)"
                  :color="soldOutCount ? 'error' : 'neutral'"
                  variant="subtle"
                  size="sm"
                />
              </template>
            </UButton>
          </UFieldGroup>
        </div>
        <nav
          ref="categoryRow"
          class="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
          aria-label="Categories"
        >
          <UButton
            v-for="c in categories"
            :key="c.id"
            :label="c.name"
            size="sm"
            data-category
            :color="category === c.id ? 'primary' : 'neutral'"
            :variant="category === c.id ? 'soft' : 'outline'"
            :aria-pressed="category === c.id"
            class="shrink-0 rounded-full"
            @click="category = c.id"
          />
        </nav>

        <div
          v-if="!rows"
          class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-label="Loading the menu"
        >
          <USkeleton
            v-for="n in 6"
            :key="n"
            class="h-40 w-full"
          />
        </div>

        <template v-else-if="groups.length">
          <p
            class="text-sm text-muted"
            role="status"
          >
            Showing {{ groups.length }} {{ groups.length === 1 ? 'item' : 'items' }}
          </p>
          <!-- One card per item, its versions the rows: the item's name once, its state at a glance. -->
          <div class="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <UCard
              v-for="group in groups"
              :key="group.itemId"
              :aria-label="group.itemName"
              :ui="{ body: 'p-0 sm:p-0' }"
            >
              <template
                v-if="!group.single"
                #header
              >
                <div class="flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <h2 class="truncate font-semibold text-highlighted">
                      {{ group.itemName }}
                    </h2>
                    <p class="truncate text-sm text-muted">
                      {{ group.categoryName }}
                    </p>
                  </div>
                  <UBadge
                    :label="stateLabel(group.rows)"
                    :color="soldOutIn(group.rows) ? 'error' : 'neutral'"
                    variant="subtle"
                    class="shrink-0"
                  />
                </div>
              </template>
              <ul
                class="divide-y divide-default"
                :aria-label="group.itemName"
              >
                <li
                  v-for="row in group.rows"
                  :key="row.variationId"
                  class="flex items-center gap-3 px-4 py-3"
                  :class="row.soldOut && 'bg-error/5'"
                  :aria-label="rowName(row)"
                >
                  <div class="min-w-0 flex-1">
                    <p
                      class="font-medium"
                      :class="row.soldOut ? 'text-muted' : 'text-highlighted'"
                    >
                      <template v-if="group.single">
                        {{ row.itemName }}
                      </template>
                      <template v-else>
                        <span class="sr-only">{{ row.itemName }} · </span>{{ row.label }}
                      </template>
                    </p>
                    <p
                      v-if="group.single"
                      class="text-sm text-muted"
                    >
                      {{ row.categoryName }}
                    </p>
                    <p
                      v-if="row.soldOut && row.since"
                      class="text-sm text-muted"
                    >
                      Since {{ formatTime(row.since) }}{{ row.by ? ` by ${row.by}` : '' }}
                    </p>
                  </div>
                  <USwitch
                    :model-value="!row.soldOut"
                    :label="row.soldOut ? 'Sold out' : 'Available'"
                    :loading="set.isPending(row.variationId)"
                    :disabled="set.isPending(row.variationId)"
                    :aria-label="`${rowName(row)}: available`"
                    :ui="{ label: ['max-sm:sr-only w-20', row.soldOut && 'font-medium text-error'] }"
                    class="shrink-0"
                    @update:model-value="value => setAvailable(row, value)"
                  />
                </li>
              </ul>
            </UCard>
          </div>
        </template>
        <p
          v-else
          class="py-10 text-center text-sm text-muted"
        >
          {{ onlySoldOut && !search.trim() ? 'Nothing is sold out.' : 'No items match.' }}
        </p>
        <p class="text-sm text-muted">
          Customers see the change the next time their menu loads.
        </p>
      </template>
    </main>
  </div>
</template>
