<script setup lang="ts">
/**
 * Payments → Needs review (D266), for the cafe's owners only: KHQR payments Bakong confirmed that
 * the order couldn't take (paid twice, paid after it was cancelled, another amount). Each open one
 * with its order, branch and what arrived, and Record return; below, the latest returned ones. The
 * count of QRs whose automatic check ended without an answer from Bakong (no token, refused) warns
 * that some payments may not have been seen. Nothing here sends money.
 */
import type { KhqrReview } from '#shared/contracts/orders'
import { useKhqrReviews } from '../composables/useExchangeRates'
import { khqrAmount, RETURN_METHODS_SHOWN, REVIEW_REASONS, reviewOrderNumber } from '../utils/khqr-review'
import KhqrReturnModal from './KhqrReturnModal.vue'

const { data, error, loading, refresh } = useKhqrReviews()
const overlay = useOverlay()
const returnModal = overlay.create(KhqrReturnModal)

const open = computed(() => data.value?.open ?? [])
const returned = computed(() => data.value?.returned ?? [])

function recordReturn(review: KhqrReview) {
  void returnModal.open({ review })
}

const foundBy = (review: KhqrReview) => (review.foundBy ? `Found by ${review.foundBy.name}'s counter` : 'Found by the automatic check')
</script>

<template>
  <UCard
    as="section"
    aria-labelledby="khqr-reviews"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <h2
          id="khqr-reviews"
          class="font-semibold text-highlighted"
        >
          KHQR payments to review
        </h2>
        <UBadge
          v-if="open.length"
          :label="String(open.length)"
          color="warning"
          variant="subtle"
          size="sm"
        />
      </div>
      <p class="text-sm text-muted">
        Payments Bakong confirmed that the order couldn't take. Give the money back, then record it here.
      </p>
    </template>

    <ApiErrorAlert
      v-if="error"
      :error="error"
      title="Could not load the payments to review"
      @retry="refresh()"
    />
    <div
      v-else-if="loading && !data"
      class="space-y-3"
    >
      <USkeleton class="h-16 w-full" />
      <USkeleton class="h-16 w-full" />
    </div>
    <div
      v-else
      class="space-y-4"
    >
      <UAlert
        v-if="data?.unchecked"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="`${data.unchecked} QR${data.unchecked === 1 ? '' : 's'} couldn't be checked with Bakong in the last 30 days`"
        description="Bakong didn't answer (no token, an expired one, or refused). A payment on them may not show here: check the bank app."
      />

      <ul
        v-if="open.length"
        class="divide-y divide-default"
        aria-label="Payments to review"
      >
        <li
          v-for="review in open"
          :key="review.id"
          class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
        >
          <div class="min-w-0 flex-1 space-y-0.5">
            <p class="font-medium text-highlighted">
              Order {{ reviewOrderNumber(review) }} · {{ review.branch.name }}
            </p>
            <p class="text-sm">
              {{ REVIEW_REASONS[review.reason] }}
            </p>
            <p class="text-sm text-muted">
              <span class="font-medium text-default tabular-nums">{{ khqrAmount(review.received) }}</span> arrived
              <template v-if="review.reason === 'amount_mismatch'">
                (the QR asked {{ khqrAmount(review.expected) }})
              </template>
              · {{ formatDateTime(review.foundAt) }} · {{ foundBy(review) }}
              <template v-if="review.bankReference">
                · Ref. {{ review.bankReference }}
              </template>
            </p>
          </div>
          <UButton
            label="Record return"
            color="neutral"
            variant="outline"
            class="max-sm:w-full max-sm:justify-center"
            @click="recordReturn(review)"
          />
        </li>
      </ul>
      <div
        v-else
        class="flex items-center gap-2 text-sm text-muted motion-safe:animate-fade-in"
      >
        <UIcon
          name="i-lucide-circle-check"
          class="size-5 text-success"
        />
        Nothing to review.
      </div>

      <UCollapsible
        v-if="returned.length"
        class="border-t border-default pt-3"
      >
        <UButton
          label="Recently returned"
          color="neutral"
          variant="link"
          trailing-icon="i-lucide-chevron-down"
          class="px-0"
          :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
        />
        <template #content>
          <ul
            class="mt-2 divide-y divide-default"
            aria-label="Recently returned"
          >
            <li
              v-for="review in returned"
              :key="review.id"
              class="space-y-0.5 py-3 text-sm"
            >
              <p class="font-medium text-highlighted">
                Order {{ reviewOrderNumber(review) }} · {{ review.branch.name }}
              </p>
              <p
                v-if="review.returned"
                class="text-muted"
              >
                {{ khqrAmount(review.returned) }} back by {{ RETURN_METHODS_SHOWN[review.returned.method] }}, {{ formatDateTime(review.returned.at) }} · recorded by {{ review.returned.by.name }}
              </p>
              <p
                v-if="review.returned"
                class="whitespace-pre-line"
              >
                {{ review.returned.note }}
              </p>
            </li>
          </ul>
        </template>
      </UCollapsible>
    </div>
  </UCard>
</template>
