<script setup lang="ts">
/**
 * `/orders`, "Your orders" (step 6.5b, D114, the owner's frame): orders in progress as cards, then
 * past ones as rows (number, when, status, total), 20 more with Load more. Opened from the account
 * menu and the menu's order bar. Browser-only, like the order page; signed out, it asks to sign in.
 * A guest (D156) is told their orders are kept on this device, with Create account to keep them.
 */
import type { CustomerOrders, OrderSummary } from '#shared/contracts/orders'
import { accountLink, ACCOUNT_PATHS, useCustomerAccount } from '~/features/account'
import { useCustomerOrders } from '../composables/useOrders'
import { formatPickupNumber, itemsText, orderTypeText, placedText, statusBadge } from '../utils/order'
import OrdersHeader from './OrdersHeader.vue'

const tenantPath = useTenantPath()

const route = useRoute()
const { guest } = useCustomerAccount()
const pages = ref(1)
const query = useCustomerOrders({ pages })
// "Load more" asks for one more page under a new key: the list shown stays until it arrives.
const list = ref<CustomerOrders | null>(null)
watch(() => query.data.value, (data) => {
  if (data) list.value = data
}, { immediate: true })
const errorKind = computed(() => query.error.value?.kind)
const hasMore = computed(() => Boolean(list.value && list.value.past.items.length < list.value.past.total))
const empty = computed(() => Boolean(list.value && !list.value.inProgress.length && !list.value.past.items.length))

const now = Date.now()
const link = (order: OrderSummary) => tenantPath(`/orders/${encodeURIComponent(order.id)}`)

useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <div class="min-h-dvh bg-muted">
    <OrdersHeader />

    <main class="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <!-- Signed out, the sign-in card's title is the page's heading. -->
      <h1
        v-if="errorKind !== 'unauthorized'"
        class="text-2xl font-semibold text-highlighted"
      >
        Your orders
      </h1>
      <UAlert
        v-if="guest"
        color="neutral"
        variant="subtle"
        icon="i-lucide-smartphone"
        title="Your orders are kept on this device"
        description="Create an account to see them anywhere: your orders move to it."
        :actions="[{ label: 'Create account', color: 'neutral', variant: 'outline', to: accountLink(ACCOUNT_PATHS.signUp, route.fullPath) }]"
      />

      <div
        v-if="!list && query.loading.value"
        class="space-y-3"
        aria-busy="true"
        aria-label="Loading your orders"
      >
        <USkeleton class="h-24 w-full" />
        <USkeleton class="h-14 w-full" />
        <USkeleton class="h-14 w-full" />
      </div>

      <UEmpty
        v-else-if="errorKind === 'unauthorized'"
        :as="{ title: 'h1' }"
        size="xl"
        icon="i-lucide-receipt"
        title="Sign in to view your orders"
        description="See your order history and track your current orders."
        :actions="[
          { label: 'Sign in', icon: 'i-lucide-log-in', size: 'md', block: true, to: accountLink(ACCOUNT_PATHS.signIn, route.fullPath) },
          { label: 'Back to menu', color: 'neutral', variant: 'link', size: 'md', to: tenantPath('/') },
        ]"
        class="mt-6 py-10 sm:mt-10 sm:py-12"
        :ui="{ avatar: 'size-16 text-3xl', title: 'text-xl font-semibold', body: 'w-full', actions: 'w-full flex-col items-center' }"
      />

      <ApiErrorAlert
        v-else-if="!list && query.error.value"
        :error="query.error.value"
        title="Couldn't load your orders"
        @retry="query.refresh()"
      />

      <UCard
        v-else-if="empty"
        :ui="{ body: 'py-10 sm:py-12' }"
      >
        <div class="flex flex-col items-center gap-4 text-center">
          <UIcon
            name="i-app-cafe-shopping-bag"
            class="size-64 sm:size-80"
          />
          <h2 class="text-3xl font-semibold text-highlighted">
            No orders yet
          </h2>
          <p class="max-w-sm text-muted">
            Explore the menu and place your first order. You can track it here once it's placed.
          </p>
          <UButton
            :to="tenantPath('/')"
            icon="i-lucide-arrow-left"
            label="Browse the menu"
          />
        </div>
      </UCard>

      <template v-else-if="list">
        <section
          v-if="list.inProgress.length"
          class="space-y-3"
          aria-labelledby="in-progress"
        >
          <h2
            id="in-progress"
            class="text-sm font-semibold text-muted"
          >
            In progress
          </h2>
          <ul class="space-y-3">
            <!-- The card's own surface is on the item, so the link's hover tints it like a Past row's. -->
            <li
              v-for="order in list.inProgress"
              :key="order.id"
              class="rounded-lg bg-default ring ring-default"
            >
              <NuxtLink
                :to="link(order)"
                class="flex items-center gap-4 rounded-lg p-4 transition-colors hover:bg-elevated/50 focus-visible:outline-2 focus-visible:outline-primary"
                :aria-label="`Order ${formatPickupNumber(order.pickupNumber)}, ${statusBadge(order.status).label}`"
              >
                <span
                  class="text-3xl font-bold tabular-nums"
                  :class="order.status === 'ready' ? 'text-success' : 'text-highlighted'"
                >{{ formatPickupNumber(order.pickupNumber) }}</span>
                <div class="min-w-0 flex-1 space-y-1">
                  <UBadge
                    v-bind="statusBadge(order.status)"
                    variant="subtle"
                  />
                  <p class="text-sm text-muted">
                    {{ itemsText(order.itemCount) }} · {{ formatMinor(order.totalMinor) }} · {{ orderTypeText(order) }}
                  </p>
                  <p class="text-sm text-muted">
                    Placed {{ placedText(order.placedAt, now) }}
                  </p>
                </div>
                <UIcon
                  name="i-lucide-chevron-right"
                  class="size-5 shrink-0 text-muted"
                />
              </NuxtLink>
            </li>
          </ul>
        </section>

        <section
          v-if="list.past.items.length"
          class="space-y-3"
          aria-labelledby="past"
        >
          <h2
            id="past"
            class="text-sm font-semibold text-muted"
          >
            Past
          </h2>
          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <ul class="divide-y divide-default">
              <li
                v-for="order in list.past.items"
                :key="order.id"
              >
                <NuxtLink
                  :to="link(order)"
                  class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-elevated/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                  :aria-label="`Order ${formatPickupNumber(order.pickupNumber)}, ${statusBadge(order.status).label}`"
                >
                  <span class="w-12 font-semibold text-highlighted tabular-nums">{{ formatPickupNumber(order.pickupNumber) }}</span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm text-highlighted">
                      {{ placedText(order.placedAt, now) }}
                    </p>
                    <p class="truncate text-sm text-muted">
                      {{ itemsText(order.itemCount) }} · {{ order.branch.name }}
                    </p>
                  </div>
                  <!-- Phones: the total above the badge; wider: side by side. -->
                  <div class="flex shrink-0 flex-col-reverse items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                    <UBadge
                      v-bind="statusBadge(order.status)"
                      variant="subtle"
                    />
                    <span class="text-sm font-medium text-highlighted sm:w-16 sm:text-right">{{ formatMinor(order.totalMinor) }}</span>
                  </div>
                </NuxtLink>
              </li>
            </ul>
          </UCard>
          <UButton
            v-if="hasMore"
            label="Load more"
            color="neutral"
            variant="outline"
            block
            :loading="query.pending.value"
            @click="pages++"
          />
        </section>
      </template>
    </main>
  </div>
</template>
