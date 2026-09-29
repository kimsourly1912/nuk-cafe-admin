<script setup lang="ts">
/**
 * The customer menu, the site's home page (D93; the owner's mockups, styled by Nuxt UI, D74).
 * Ordering first: no banner or blog, the menu starts under the header.
 *
 * - **Header** (sticky): the cafe, the branch and whether it's open, search, and the order type
 *   (Pickup, or the table a QR code named). Under it, the category bar (`MenuCategoryBar`).
 * - **Sections**: a main category per section, its sub-categories as sub-sections. The tabs and the
 *   tree follow the section being read (`useScrollSpy`) and scroll to the one chosen.
 * - **Search** replaces the sections with the matches, grouped by where they are, in the same cards.
 * - **Items**: cards from `sm`, rows on phones; the add slot changes in place (`MenuAddControl`);
 *   the name opens the detail (`MenuItemDetail`).
 * - **The order**: a panel beside the menu from `lg`; below it a bottom bar once something is in
 *   it, opening the order in a bottom sheet. Checkout comes with step 6.2.
 * - **Closed**: one warning banner with when it opens; browsing works, adding doesn't.
 *
 * Server-rendered (D95): what differs by width is CSS, never `useLayoutContext`, so the server's page
 * and the browser's first render agree. The menu is the server's first branch until the browser's
 * stored table or branch choice (read after mounting) asks for another.
 */
import { useElementSize } from '@vueuse/core'
import { AccountButton, VerifyEmailBanner } from '~/features/account'
import type { PublicMenuItem } from '#shared/contracts/public-menu'
import { usePublicMenu, useCart, useShopBranch, useTableContext } from '../composables/useShopMenu'
import { useScrollSpy } from '../composables/useScrollSpy'
import { lineKey, quantityOfItem, resolveCart } from '../utils/cart'
import { menuItems, menuSections, searchMenu } from '../utils/menu'
import { openingText } from '../utils/opening'
import MenuCategoryBar from './MenuCategoryBar.vue'
import MenuItemDetail from './MenuItemDetail.vue'
import MenuItemList from './MenuItemList.vue'
import OrderPanel from './OrderPanel.vue'

// --- Branch, table and menu ---
const { branches, requestedBranchId, choose } = useShopBranch()
const { table, clearTable } = useTableContext()
const menuQuery = usePublicMenu(requestedBranchId)
const menu = computed(() => menuQuery.data.value ?? null)
const branch = computed(() => menu.value?.branch)
/** The branch whose menu is shown (the order belongs to it). */
const branchId = computed(() => branch.value?.id)
const closed = computed(() => !branch.value?.openNow)
const closedNote = computed(() => (branch.value ? openingText(branch.value) : undefined))
const loading = computed(() => menuQuery.loading.value)
/** No active branch at all: the server has no menu to show yet. */
const noBranch = computed(() => menuQuery.error.value?.kind === 'not_found')
const loadError = computed(() => (noBranch.value ? undefined : menuQuery.error.value))
const retry = () => menuQuery.refresh()

useSeoMeta({
  description: 'Browse the NUK Cafe menu and order coffee, tea and bakes for pickup or at your table.',
  ogTitle: 'NUK Cafe menu',
  ogDescription: 'Browse the NUK Cafe menu and order for pickup or at your table.',
})

/** "Table 12" (a label may already say "Table"), or "Pickup". */
const orderType = computed(() => {
  const label = table.value?.label
  if (!label) return 'Pickup'
  return /^table\b/i.test(label) ? label : `Table ${label}`
})

const sections = computed(() => menuSections(menu.value))
const allItems = computed(() => menuItems(sections.value))

// --- Search ---
const search = ref('')
/** Phones: the header turns into the search field. */
const searching = ref(false)
const results = computed(() => searchMenu(sections.value, search.value))
function closeSearch() {
  search.value = ''
  searching.value = false
}

// --- Scroll spy: the sticky header's height is the offset ---
const header = useTemplateRef<HTMLElement>('header')
const { height: headerHeight } = useElementSize(header, undefined, { box: 'border-box' })
const offset = computed(() => headerHeight.value + 8)
// The order panel sticks below the header: a CSS variable set in the browser, not a rendered style,
// so the server's page (which can't measure) and the browser's agree.
watch(offset, value => document.documentElement.style.setProperty('--shop-header', `${value}px`))
const sectionIds = computed(() => (search.value ? [] : sections.value.flatMap(s => [s.id, ...s.subSections.map(sub => sub.id)])))
const { active, scrollTo } = useScrollSpy(() => sectionIds.value.map(id => `section-${id}`), offset)
const mainOf = computed(() => new Map(sections.value.flatMap(s => [[s.id, s.id], ...s.subSections.map(sub => [sub.id, s.id] as [string, string])])))
const activeId = computed(() => active.value?.replace(/^section-/, ''))
const activeMainId = computed(() => (activeId.value ? mainOf.value.get(activeId.value) : sections.value[0]?.id))
const activeSubId = computed(() => (activeId.value && activeId.value !== activeMainId.value ? activeId.value : undefined))

// --- The order ---
const cartStore = useCart(branchId)
const cart = computed(() => resolveCart(cartStore.lines.value, allItems.value))
const quantityOf = (item: PublicMenuItem) => quantityOfItem(cartStore.lines.value, item.id)
const orderOpen = ref(false)

/** An item with nothing to choose: its only version, no add-ons. */
function quickAdd(item: PublicMenuItem) {
  cartStore.add({ itemId: item.id, variationId: item.variations[0]!.id, modifierIds: [], quantity: 1, name: item.name })
}
function setSimpleQuantity(item: PublicMenuItem, quantity: number) {
  cartStore.setQuantity(lineKey(item.variations[0]!.id, []), quantity)
}

// --- Item detail ---
const detailItem = shallowRef<PublicMenuItem>()
const detailOpen = ref(false)
function openItem(item: PublicMenuItem) {
  detailItem.value = item
  detailOpen.value = true
}
function addFromDetail(line: { variationId: string, modifierIds: string[], quantity: number }) {
  if (!detailItem.value) return
  cartStore.add({ ...line, itemId: detailItem.value.id, name: detailItem.value.name })
}
</script>

<template>
  <div class="min-h-dvh">
    <header
      ref="header"
      class="sticky top-0 z-30 border-b border-default bg-default/95 backdrop-blur"
    >
      <div class="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <template v-if="searching">
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            aria-label="Close search"
            @click="closeSearch"
          />
          <SearchInput
            v-model="search"
            :delay="150"
            placeholder="Search the menu"
            autofocus
            class="min-w-0 flex-1"
          />
        </template>
        <template v-else>
          <NuxtLink
            to="/"
            class="flex shrink-0 items-center gap-2 font-semibold text-highlighted"
          >
            <UIcon
              name="i-lucide-coffee"
              class="size-5 text-primary"
            />
            NUK Cafe
          </NuxtLink>
          <p
            v-if="branch"
            class="hidden min-w-0 truncate text-sm text-muted md:block"
          >
            {{ branch.name }} ·
            <span :class="branch.openNow ? 'text-success' : 'text-muted'">{{ branch.openNow ? 'Open now' : 'Closed' }}</span>
          </p>
          <div class="ms-auto flex items-center gap-2">
            <SearchInput
              v-model="search"
              :delay="150"
              placeholder="Search the menu"
              class="w-56 max-sm:hidden lg:w-72"
            />
            <UButton
              class="sm:hidden"
              icon="i-lucide-search"
              color="neutral"
              variant="ghost"
              aria-label="Search the menu"
              @click="searching = true"
            />
            <UPopover :content="{ align: 'end' }">
              <UButton
                :icon="table ? 'i-lucide-utensils' : 'i-lucide-shopping-bag'"
                :label="orderType"
                trailing-icon="i-lucide-chevron-down"
                color="neutral"
                variant="outline"
                :aria-label="`Order type: ${orderType}`"
              />
              <template #content>
                <div class="w-72 space-y-3 p-4">
                  <template v-if="table">
                    <p class="font-medium text-highlighted">
                      Dine-in · {{ orderType }}
                    </p>
                    <p class="text-sm text-muted">
                      You're ordering for this table{{ branch ? ` at ${branch.name}` : '' }}.
                    </p>
                    <UButton
                      label="Switch to pickup"
                      color="neutral"
                      variant="outline"
                      block
                      @click="clearTable"
                    />
                  </template>
                  <template v-else>
                    <p class="font-medium text-highlighted">
                      Pickup{{ branch ? ` at ${branch.name}` : '' }}
                    </p>
                    <p class="text-sm text-muted">
                      Collect your order at the counter. To order for a table, scan the QR code on it.
                    </p>
                    <UFormField
                      v-if="branches.length > 1"
                      label="Branch"
                    >
                      <USelect
                        :model-value="branchId"
                        :items="branches.map(b => ({ label: b.name, value: b.id }))"
                        class="w-full"
                        @update:model-value="value => choose(String(value))"
                      />
                    </UFormField>
                  </template>
                </div>
              </template>
            </UPopover>
            <UColorModeButton />
            <AccountButton />
          </div>
        </template>
      </div>
      <div
        v-if="sections.length && !search"
        class="mx-auto max-w-7xl px-4 pb-2"
      >
        <MenuCategoryBar
          :sections="sections"
          :active-main-id="activeMainId"
          :active-sub-id="activeSubId"
          @go="id => scrollTo(`section-${id}`)"
        />
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-4 pt-4 pb-10 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
      <div class="min-w-0 space-y-8">
        <VerifyEmailBanner />
        <UAlert
          v-if="branch && closed"
          color="warning"
          variant="subtle"
          icon="i-lucide-clock"
          title="Closed now"
          :description="closedNote ?? 'Online ordering isn\'t available right now.'"
        />
        <ApiErrorAlert
          v-if="loadError"
          :error="loadError"
          title="Could not load the menu"
          @retry="retry"
        />

        <div
          v-if="loading"
          class="space-y-4"
          aria-busy="true"
          aria-label="Loading the menu"
        >
          <USkeleton class="h-7 w-40" />
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <USkeleton
              v-for="n in 6"
              :key="n"
              class="h-36"
            />
          </div>
        </div>

        <div
          v-else-if="noBranch"
          class="py-16 text-center text-muted"
        >
          The menu isn't available yet.
        </div>

        <template v-else-if="search">
          <p
            class="text-sm text-muted"
            role="status"
          >
            {{ pluralize(results.reduce((sum, group) => sum + group.items.length, 0), ['result', 'results']) }} for "{{ search }}"
          </p>
          <section
            v-for="group in results"
            :key="group.path"
            class="space-y-3"
          >
            <h2 class="text-sm font-semibold text-muted">
              {{ group.path }}
            </h2>
            <MenuItemList
              :items="group.items"
              :closed="closed"
              :quantity-of="quantityOf"
              :highlight="search"
              @open="openItem"
              @add="quickAdd"
              @set-quantity="setSimpleQuantity"
            />
          </section>
          <div
            v-if="!results.length"
            class="flex flex-col items-center gap-3 py-12 text-center"
          >
            <UIcon
              name="i-lucide-search-x"
              class="size-8 text-dimmed"
            />
            <p class="font-medium text-highlighted">
              No items match "{{ search }}"
            </p>
            <UButton
              label="Clear search"
              color="neutral"
              variant="outline"
              @click="search = ''"
            />
          </div>
        </template>

        <template v-else-if="menu">
          <div
            v-if="!sections.length"
            class="py-16 text-center text-muted"
          >
            Nothing is on the menu right now.
          </div>
          <section
            v-for="section in sections"
            :id="`section-${section.id}`"
            :key="section.id"
            :aria-labelledby="`heading-${section.id}`"
            tabindex="-1"
            class="space-y-4 outline-none"
          >
            <div>
              <h2
                :id="`heading-${section.id}`"
                class="text-xl font-semibold text-highlighted"
              >
                {{ section.name }}
              </h2>
              <p
                v-if="section.description"
                class="text-sm text-muted"
              >
                {{ section.description }}
              </p>
            </div>
            <MenuItemList
              v-if="section.items.length"
              :items="section.items"
              :closed="closed"
              :quantity-of="quantityOf"
              @open="openItem"
              @add="quickAdd"
              @set-quantity="setSimpleQuantity"
            />
            <div
              v-for="sub in section.subSections"
              :id="`section-${sub.id}`"
              :key="sub.id"
              tabindex="-1"
              class="space-y-3 outline-none"
            >
              <h3 class="font-semibold text-highlighted">
                {{ sub.name }}
                <span class="font-normal text-muted">· {{ pluralize(sub.items.length, ['item', 'items']) }}</span>
              </h3>
              <p
                v-if="sub.description"
                class="-mt-2 text-sm text-muted"
              >
                {{ sub.description }}
              </p>
              <MenuItemList
                :items="sub.items"
                :closed="closed"
                :quantity-of="quantityOf"
                @open="openItem"
                @add="quickAdd"
                @set-quantity="setSimpleQuantity"
              />
            </div>
          </section>
        </template>
      </div>

      <aside
        class="hidden lg:block"
        aria-label="Your order"
      >
        <UCard class="sticky top-[calc(var(--shop-header,7rem)+0.5rem)]">
          <OrderPanel
            :cart="cart"
            :order-type="orderType"
            :closed="closed"
            :closed-note="closedNote"
            @set-quantity="cartStore.setQuantity"
          />
        </UCard>
      </aside>
    </main>

    <!-- Below lg: the order in a bottom bar once something is in it, the lines in a bottom sheet -->
    <BottomActionBar
      label="Your order"
      :open="cart.lines.length > 0"
      expanded="hidden"
    >
      <p class="min-w-0 flex-1 text-sm">
        <span class="font-medium text-highlighted">{{ pluralize(cart.count, ['item', 'items']) }}</span>
        <span class="text-muted"> · {{ formatMinor(cart.subtotalMinor) }}</span>
      </p>
      <UButton
        label="View order"
        icon="i-lucide-shopping-bag"
        @click="orderOpen = true"
      />
    </BottomActionBar>
    <UDrawer
      v-model:open="orderOpen"
      title="Your order"
      :ui="{ header: 'sr-only', content: 'max-h-[85dvh]', body: 'overflow-y-auto' }"
    >
      <template #body>
        <OrderPanel
          :cart="cart"
          :order-type="orderType"
          :closed="closed"
          :closed-note="closedNote"
          @set-quantity="cartStore.setQuantity"
        />
      </template>
    </UDrawer>

    <MenuItemDetail
      v-if="detailItem"
      v-model:open="detailOpen"
      :item="detailItem"
      :closed="closed"
      :closed-note="closedNote"
      @add="addFromDetail"
    />
  </div>
</template>
