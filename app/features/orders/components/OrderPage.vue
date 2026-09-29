<script setup lang="ts">
/**
 * `/orders/<id>`, the order the customer placed (step 6.2b, D100; the owner's mockups, styled by
 * Nuxt UI, D74): the pickup number as the hero, its status, what to do next (pay at the counter;
 * for a table, then we bring it), the time to pay by, and a summary of the lines. Its own address,
 * so a reload or another tab still shows it; order tracking (6.5) grows from here.
 *
 * Browser-only (`routeRules`): only its customer may read it (`GET /api/shop/orders/{id}`: anyone
 * else's is "not found", like an unknown id).
 */
import type { Order } from '#shared/contracts/orders'
import { AccountButton, accountLink, ACCOUNT_PATHS } from '~/features/account'
import { clockTime, formatPickupNumber, nextStep, statusBadge, tableName } from '../utils/order'

const route = useRoute()
const id = computed(() => String(route.params.id ?? ''))
const query = useApiQuery(() => `orders:order:${id.value}`, () => apiFetch<Order>(`/shop/orders/${encodeURIComponent(id.value)}`), { server: false })
const order = computed(() => query.data.value ?? null)
const errorKind = computed(() => query.error.value?.kind)
const badge = computed(() => (order.value ? statusBadge(order.value.status) : null))

useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <div class="min-h-dvh bg-muted">
    <header class="border-b border-default bg-default">
      <div class="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <NuxtLink
          to="/"
          class="flex items-center gap-2 font-semibold text-highlighted"
        >
          <UIcon
            name="i-lucide-coffee"
            class="size-5 text-primary"
          />
          NUK Cafe
        </NuxtLink>
        <div class="ms-auto flex items-center gap-2">
          <UColorModeButton />
          <AccountButton />
        </div>
      </div>
    </header>

    <main class="mx-auto flex max-w-lg flex-col px-4 py-6 max-sm:min-h-[calc(100dvh-3.5rem)] max-sm:px-0 max-sm:py-0">
      <div
        v-if="query.loading.value"
        class="space-y-3 p-4"
        aria-busy="true"
        aria-label="Loading your order"
      >
        <USkeleton class="mx-auto h-16 w-40" />
        <USkeleton class="h-24 w-full" />
      </div>

      <UCard
        v-else-if="errorKind === 'unauthorized'"
        class="max-sm:flex-1 max-sm:rounded-none max-sm:ring-0"
      >
        <div class="space-y-3 text-center">
          <p class="font-medium text-highlighted">
            Sign in to see this order
          </p>
          <UButton
            label="Sign in"
            :to="accountLink(ACCOUNT_PATHS.signIn, route.fullPath)"
          />
        </div>
      </UCard>

      <UCard
        v-else-if="!order"
        class="max-sm:flex-1 max-sm:rounded-none max-sm:ring-0"
      >
        <div class="space-y-3 text-center">
          <p class="font-medium text-highlighted">
            {{ errorKind === 'not_found' ? 'This order wasn\'t found' : 'Couldn\'t load this order' }}
          </p>
          <p class="text-sm text-muted">
            {{ errorKind === 'not_found' ? 'It may belong to another account.' : 'Check your connection and try again.' }}
          </p>
          <div class="flex justify-center gap-2">
            <UButton
              v-if="errorKind !== 'not_found'"
              label="Try again"
              color="neutral"
              variant="outline"
              @click="query.refresh()"
            />
            <UButton
              label="Back to the menu"
              to="/"
            />
          </div>
        </div>
      </UCard>

      <UCard
        v-else
        class="max-sm:flex max-sm:flex-1 max-sm:flex-col max-sm:rounded-none max-sm:ring-0"
        :ui="{ body: 'space-y-5 max-sm:flex-1', footer: 'max-sm:pb-[max(env(safe-area-inset-bottom),1rem)]' }"
      >
        <div class="space-y-2 text-center">
          <p class="text-sm text-muted">
            Your number
          </p>
          <h1
            class="text-6xl font-bold tracking-tight text-highlighted tabular-nums"
            :aria-label="`Your number ${formatPickupNumber(order.pickupNumber)}`"
          >
            {{ formatPickupNumber(order.pickupNumber) }}
          </h1>
          <UBadge
            v-if="badge"
            :label="badge.label"
            :color="badge.color"
            variant="subtle"
            icon="i-lucide-clock"
          />
        </div>

        <div
          v-if="order.status === 'awaiting_payment'"
          class="space-y-1 text-center"
        >
          <p class="text-lg font-semibold text-highlighted">
            {{ nextStep(order) }}
          </p>
          <p class="text-sm text-muted">
            Pay within 30 minutes or the order is cancelled: <span class="whitespace-nowrap">by {{ clockTime(order.paymentDueAt) }}.</span>
          </p>
        </div>

        <div class="border-t border-default pt-4">
          <ul
            class="space-y-2 text-sm"
            aria-label="Order summary"
          >
            <li
              v-for="(line, index) in order.lines"
              :key="index"
              class="flex justify-between gap-3"
            >
              <div class="min-w-0">
                <p class="text-highlighted">
                  {{ line.quantity }} × {{ line.itemName }}
                </p>
                <p
                  v-if="line.detail || line.note"
                  class="text-muted"
                >
                  {{ [line.detail, line.note].filter(Boolean).join(' · ') }}
                </p>
              </div>
              <span class="shrink-0 text-highlighted">{{ formatMinor(line.totalMinor) }}</span>
            </li>
          </ul>
          <div class="mt-4 flex items-baseline justify-between border-t border-default pt-3">
            <span class="font-semibold text-highlighted">Total</span>
            <span class="text-lg font-semibold text-highlighted">{{ formatMinor(order.totalMinor) }}</span>
          </div>
          <p class="mt-2 text-center text-sm text-muted">
            {{ order.branch.name }} · {{ order.orderType === 'dine_in' && order.table ? `Dine-in · ${tableName(order.table.label)}` : 'Pickup' }}
          </p>
        </div>

        <template #footer>
          <UButton
            label="Back to the menu"
            to="/"
            block
          />
        </template>
      </UCard>
    </main>
  </div>
</template>
