<script setup lang="ts">
/**
 * `/checkout`, Review order (step 6.2b, D100; the owner's mockups, styled by Nuxt UI, D74): the
 * order kept in this browser, priced by the server, then placed.
 *
 * - **Order type:** pickup at the branch, as soon as possible; or dine-in at the table a QR code
 *   named, with "Switch to pickup".
 * - **Lines:** quantity, Remove, a note each; a line that can't be ordered says why and offers
 *   Remove. Prices come from the server's quote, never from the page.
 * - **Summary** (beside the lines from `lg`, a bottom bar below): the total and "Place order · $x".
 *   Pay at the counter; unpaid orders are cancelled after 30 minutes.
 * - **No account needed** (D156): signed out (or a guest), "Your name" is asked for the counter,
 *   with "Have an account? Sign in"; Place order makes this browser a guest. An account orders under
 *   its own name, verified email or not.
 * - **Changes:** prices that changed since the customer saw them are struck through with a warning;
 *   the new total is on the button, so pressing it accepts them. A refused order says why, on the
 *   page; a lost answer offers Try again with the same key (never a second order).
 *
 * Browser-only (`routeRules`, D100): everything on it is this visitor's own.
 */
import { useMounted } from '@vueuse/core'
import { GUEST_NAME_MAX } from '#shared/contracts/orders'
import { ACCOUNT_PATHS, AccountButton, accountLink, useCustomerAccount } from '~/features/account'
import { tableName } from '~/features/orders'
import { useCheckout } from '../composables/useCheckout'
import type { CartLine } from '../utils/cart'
import { lineKey } from '../utils/cart'
import { openingText } from '../utils/opening'
import CheckoutLine from './CheckoutLine.vue'

const tenantPath = useTenantPath()
const { name: cafeName, logoUrl } = useCafe()

const mounted = useMounted()
const checkout = useCheckout()
const { cart, quote, quoteSettling, change, placing, placed, failure } = checkout
const { account, guest, known } = useCustomerAccount()
const route = useRoute()

const lines = computed(() => cart.lines.value)
const quoted = computed(() => quote.data.value ?? null)
// By key, not position: removing a line keeps the others' prices while the new quote comes.
const quotedLine = (cartLine: CartLine) =>
  quoted.value?.lines.find(line => lineKey(line.variationId, line.modifierIds) === cartLine.key)
// No price for a line yet means its quote is on its way, unless the quote failed (said above).
const lineLoading = (cartLine: CartLine) => !quotedLine(cartLine) && !quote.error.value
const linesLoading = computed(() => lines.value.some(lineLoading))
const branch = computed(() => quoted.value?.branch)
const orderProblem = computed(() => quoted.value?.problems[0])
const closedNote = computed(() => (branch.value ? openingText(branch.value) : undefined))
const hasLineProblem = computed(() => quoted.value?.lines.some(line => line.problem) ?? false)
/**
 * First load: one skeleton until the page knows what to show (never the empty state or a field
 * that then goes away): who orders (an account asks no name), the branches (the order and its
 * table are kept per branch) and the order's first prices.
 */
const loading = computed(() => !mounted.value || !known.value || checkout.shop.loading.value
  || (lines.value.length > 0 && !quoted.value && !quote.error.value))
/** Without the branches the order can't be read: not "Your order is empty". */
const shopError = computed(() => (checkout.shop.branches.value.length ? undefined : checkout.shop.error.value))

// --- Without an account: the name the counter calls (D156) ---
const guestName = ref('')
// A guest's earlier name, once known ("Guest" is the placeholder before their first order).
watch(guest, (next) => {
  if (next && next.name !== 'Guest' && !guestName.value) guestName.value = next.name
}, { immediate: true })
const nameError = ref<string>()
const nameInput = useTemplateRef('nameInput')
watch(guestName, () => (nameError.value = undefined))

async function submit() {
  if (!account.value && !guestName.value.trim()) {
    nameError.value = 'Enter your name'
    nameInput.value?.inputRef?.focus()
    return
  }
  const order = await checkout.place({ guestName: guestName.value.trim() })
  if (order) await navigateTo(tenantPath(`/orders/${order.id}`), { replace: true })
}

const action = computed(() => {
  if (loading.value) return { label: 'Place order', disabled: true, loading: true }
  const total = quoted.value ? ` · ${formatMinor(quoted.value.totalMinor)}` : ''
  return {
    label: placing.value ? 'Placing order…' : `Place order${total}`,
    disabled: !quoted.value?.orderable || quoteSettling.value || quote.pending.value || placing.value,
    loading: placing.value,
  }
})

/** Why the button is off, under it. */
const blockedNote = computed(() => {
  if (!quoted.value || placing.value) return undefined
  if (orderProblem.value?.code === 'BRANCH_CLOSED') return 'Available when the cafe is open.'
  if (orderProblem.value) return orderProblem.value.message
  if (hasLineProblem.value) return 'Remove the unavailable items to continue.'
  return undefined
})

function switchToPickup() {
  checkout.clearTable()
  checkout.dismissFailure()
}

useSeoMeta({ robots: 'noindex' })
</script>

<template>
  <div class="min-h-dvh">
    <header class="border-b border-default bg-default">
      <div class="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <NuxtLink
          :to="tenantPath('/')"
          class="flex items-center gap-2 font-semibold text-highlighted"
        >
          <CafeLogo
            :url="logoUrl"
            class="size-5"
          />
          {{ cafeName }}
        </NuxtLink>
        <div class="ms-auto flex items-center gap-2">
          <UColorModeButton class="max-lg:hidden" />
          <AccountButton />
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-5xl px-4 pt-4 pb-40 lg:pb-10">
      <UButton
        :to="tenantPath('/')"
        label="Back to the menu"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="link"
        class="-ms-2.5"
      />
      <h1 class="mt-1 text-2xl font-semibold text-highlighted">
        Review order
      </h1>

      <!-- Shaped like the page below: the order type, the lines and, from lg, the summary -->
      <div
        v-if="loading || placed"
        class="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6"
        role="status"
        :aria-label="placed ? 'Opening your order' : 'Loading your order'"
      >
        <div class="space-y-4">
          <div class="flex items-center gap-3 rounded-lg border border-default p-4 sm:p-6">
            <USkeleton class="size-5 shrink-0 rounded" />
            <div class="flex-1 space-y-2">
              <USkeleton class="h-4 w-40" />
              <USkeleton class="h-3 w-28" />
            </div>
          </div>
          <div class="divide-y divide-default rounded-lg border border-default px-4 sm:px-6">
            <div
              v-for="i in Math.min(Math.max(lines.length, 1), 4)"
              :key="i"
              class="flex gap-3 py-4"
            >
              <USkeleton class="size-14 shrink-0 rounded-md" />
              <div class="flex-1 space-y-2">
                <USkeleton class="h-4 w-1/2" />
                <USkeleton class="h-3 w-1/3" />
              </div>
              <USkeleton class="h-4 w-14" />
            </div>
          </div>
        </div>
        <div class="hidden space-y-4 rounded-lg border border-default p-6 lg:block">
          <USkeleton class="h-5 w-32" />
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-6 w-full" />
          <USkeleton class="h-16 w-full" />
          <USkeleton class="h-11 w-full" />
        </div>
      </div>

      <div
        v-else-if="shopError"
        class="mt-4"
      >
        <ApiErrorAlert
          :error="shopError"
          title="Couldn't load your order"
          @retry="checkout.shop.refresh()"
        />
      </div>

      <div
        v-else-if="!lines.length"
        class="flex flex-col items-center gap-3 py-16 text-center"
      >
        <UIcon
          name="i-lucide-shopping-bag"
          class="size-10 text-dimmed"
        />
        <p class="font-medium text-highlighted">
          Your order is empty
        </p>
        <UButton
          :to="tenantPath('/')"
          label="Back to the menu"
        />
      </div>

      <template v-else>
        <div class="mt-4 space-y-3">
          <UAlert
            v-if="change"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Prices have changed"
            description="The cafe updated some prices since you added these items. Check the new total before placing your order."
          />
          <!-- A refusal for new prices is the warning above; this says the rest -->
          <div
            v-if="failure && !(failure.kind === 'requote' && change)"
            role="alert"
          >
            <UAlert
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
              :title="failure.message"
              :actions="failure.kind === 'table'
                ? [{ label: 'Switch to pickup', color: 'neutral', variant: 'outline', disabled: placing, onClick: switchToPickup }]
                : failure.kind === 'retry'
                  ? [{ label: 'Try again', color: 'neutral', variant: 'outline', disabled: placing, onClick: submit }]
                  : undefined"
            />
          </div>
          <UAlert
            v-if="orderProblem"
            color="warning"
            variant="subtle"
            icon="i-lucide-clock"
            :title="orderProblem.message"
            :description="closedNote"
          />
          <ApiErrorAlert
            v-if="quote.error.value"
            :error="quote.error.value"
            title="Couldn't check the prices"
            @retry="quote.refresh()"
          />
        </div>

        <div class="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
          <div class="space-y-4">
            <UCard :ui="{ body: 'flex items-center gap-3' }">
              <UIcon
                :name="checkout.table.value ? 'i-lucide-utensils' : 'i-lucide-shopping-bag'"
                class="size-5 shrink-0 text-muted"
              />
              <div class="min-w-0 flex-1">
                <p class="font-medium text-highlighted">
                  <template v-if="checkout.table.value">
                    Dine-in · {{ tableName(checkout.table.value.label) }}
                  </template>
                  <template v-else>
                    Pickup{{ branch ? ` at ${branch.name}` : '' }}
                  </template>
                </p>
                <p class="text-sm text-muted">
                  {{ checkout.table.value ? `We'll bring it to your table${branch ? ` at ${branch.name}` : ''}.` : 'As soon as possible' }}
                </p>
              </div>
              <UButton
                v-if="checkout.table.value"
                label="Switch to pickup"
                color="neutral"
                variant="outline"
                size="sm"
                :disabled="placing"
                @click="switchToPickup"
              />
            </UCard>

            <UCard
              v-if="!account"
              :ui="{ body: 'space-y-3' }"
            >
              <UFormField
                label="Your name"
                description="The counter calls it when your order is ready."
                :error="nameError"
                required
              >
                <UInput
                  ref="nameInput"
                  v-model="guestName"
                  autocomplete="given-name"
                  :maxlength="GUEST_NAME_MAX"
                  :disabled="placing"
                  class="w-full"
                />
              </UFormField>
              <p class="text-sm text-muted">
                No account needed.
                <ULink
                  :to="accountLink(ACCOUNT_PATHS.signIn, route.fullPath)"
                  class="font-medium text-primary"
                >
                  Have an account? Sign in
                </ULink>
              </p>
            </UCard>

            <UCard :ui="{ body: 'py-0 sm:py-0' }">
              <ul
                class="divide-y divide-default"
                aria-label="Your order"
                :aria-busy="linesLoading"
              >
                <CheckoutLine
                  v-for="line in lines"
                  :key="line.key"
                  :line="line"
                  :quoted="quotedLine(line)"
                  :loading="lineLoading(line)"
                  :previous-unit-price-minor="change?.previousUnitPrices.get(line.key)"
                  :disabled="placing"
                  @set-quantity="value => cart.setQuantity(line.key, value)"
                  @set-note="value => cart.setNote(line.key, value)"
                />
              </ul>
            </UCard>
          </div>

          <aside
            class="hidden lg:block"
            aria-label="Order summary"
          >
            <UCard
              class="sticky top-4"
              :ui="{ body: 'space-y-4' }"
            >
              <h2 class="font-semibold text-highlighted">
                Order summary
              </h2>
              <div class="space-y-2 text-sm">
                <div class="flex justify-between">
                  <span class="text-muted">Subtotal</span>
                  <USkeleton
                    v-if="!quoted"
                    class="h-4 w-14"
                  />
                  <span v-else>{{ formatMinor(quoted.subtotalMinor) }}</span>
                </div>
                <div
                  v-if="quoted?.savingsMinor"
                  class="flex justify-between text-error"
                >
                  <span>Promotions saved you</span>
                  <span class="font-medium">{{ formatMinor(quoted.savingsMinor) }}</span>
                </div>
                <div class="flex items-baseline justify-between border-t border-default pt-2">
                  <span class="font-semibold text-highlighted">Total</span>
                  <USkeleton
                    v-if="!quoted"
                    class="h-6 w-20"
                  />
                  <span
                    v-else
                    class="text-lg font-semibold text-highlighted"
                  >
                    <span
                      v-if="change?.previousTotalMinor !== undefined && change?.previousTotalMinor !== null && change.previousTotalMinor !== quoted.totalMinor"
                      class="me-1 text-sm font-normal text-muted line-through"
                    >{{ formatMinor(change.previousTotalMinor) }}</span>
                    {{ formatMinor(quoted.totalMinor) }}
                  </span>
                </div>
              </div>
              <UAlert
                color="neutral"
                variant="subtle"
                icon="i-lucide-store"
                description="Pay at the counter (cash or KHQR). We start preparing once you've paid."
              />
              <UButton
                :label="action.label"
                block
                size="lg"
                :disabled="action.disabled"
                :loading="action.loading"
                @click="submit"
              />
              <p class="text-center text-xs text-muted">
                {{ blockedNote ?? 'Unpaid orders are cancelled after 30 minutes.' }}
              </p>
            </UCard>
          </aside>
        </div>
      </template>
    </main>

    <!-- Below lg: the total and the button in thumb reach -->
    <BottomActionBar
      label="Place your order"
      :open="!loading && !placed && lines.length > 0"
      expanded="hidden"
    >
      <div class="w-full space-y-2">
        <div class="flex items-baseline justify-between">
          <span class="text-sm text-muted">Total</span>
          <USkeleton
            v-if="!quoted"
            class="h-5 w-16"
          />
          <span
            v-else
            class="font-semibold text-highlighted"
          >{{ formatMinor(quoted.totalMinor) }}</span>
        </div>
        <UButton
          :label="action.label"
          block
          :disabled="action.disabled"
          :loading="action.loading"
          @click="submit"
        />
        <p class="text-center text-xs text-muted">
          {{ blockedNote ?? 'Pay at the counter. Unpaid orders are cancelled after 30 minutes.' }}
        </p>
      </div>
    </BottomActionBar>
  </div>
</template>
