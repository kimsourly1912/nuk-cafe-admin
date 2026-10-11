<script setup lang="ts">
/**
 * A promotion's page (`/admin/promotions/[id]`, M1, D163): how it's doing and what it is. The main
 * column holds the results (orders paid at its price, items sold, the discount given, sales) and
 * its details; the side column its poster, to download for posting. Actions follow its phase:
 * Edit, Publish, End now, Delete draft; an ended one can Run again (a new promotion from it).
 * Below the results, its posts to channels with Post to channels (M2a, D164).
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import { usePromotion, usePromotionMutations, usePromotionResults } from '../composables/usePromotions'
import { dateText, localToday, PHASES, timingText, whenText } from '../schemas/promotion-form'
import PromotionPostsCard from './PromotionPostsCard.vue'

const props = defineProps<{ id: string }>()

const tenantPath = useTenantPath()
const today = localToday()
const { data: promotion, error, refresh, loading } = usePromotion(props.id)
const { data: results, error: resultsError, refresh: refreshResults } = usePromotionResults(props.id)
const { publish, end, remove, isBusy } = usePromotionMutations()

const phase = computed(() => promotion.value && PHASES[promotion.value.phase])
const busy = computed(() => isBusy(props.id))

async function deleteDraft() {
  if (!promotion.value) return
  const result = await remove.execute(promotion.value)
  if (result.ok) await navigateTo(tenantPath('/admin/promotions'))
}

const more = computed<DropdownMenuItem[]>(() => {
  const p = promotion.value
  if (!p) return []
  if (p.phase === 'draft') return [{ label: 'Delete draft', icon: 'i-lucide-trash-2', color: 'error', onSelect: deleteDraft }]
  if (p.phase === 'live' || p.phase === 'scheduled') return [{ label: 'End now', icon: 'i-lucide-circle-stop', color: 'error', onSelect: () => end.execute(p) }]
  return []
})
</script>

<template>
  <UDashboardPanel id="promotion">
    <template #header>
      <UDashboardNavbar :title="promotion?.name ?? 'Promotion'">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :to="tenantPath('/admin/promotions')"
            aria-label="Back to promotions"
          />
        </template>
        <template
          v-if="promotion"
          #right
        >
          <UButton
            v-if="promotion.phase === 'draft'"
            label="Publish"
            icon="i-lucide-send"
            :loading="publish.isPending(`promotion:${promotion.id}`)"
            :disabled="busy"
            @click="publish.execute(promotion)"
          />
          <UButton
            v-if="promotion.phase !== 'ended'"
            label="Edit"
            icon="i-lucide-pencil"
            :color="promotion.phase === 'draft' ? 'neutral' : 'primary'"
            :variant="promotion.phase === 'draft' ? 'outline' : 'solid'"
            :to="tenantPath(`/admin/promotions/${promotion.id}/edit`)"
            :disabled="busy"
          />
          <UButton
            v-else
            label="Run again"
            icon="i-lucide-copy"
            :to="tenantPath(`/admin/promotions/new?copy=${promotion.id}`)"
          />
          <UDropdownMenu
            v-if="more.length"
            :items="more"
            :content="{ align: 'end' }"
          >
            <UButton
              icon="i-lucide-ellipsis-vertical"
              color="neutral"
              variant="ghost"
              aria-label="More actions"
              :disabled="busy"
            />
          </UDropdownMenu>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="error && !promotion"
        :error="error"
        title="Could not load the promotion"
        @retry="refresh()"
      />
      <ListSkeleton
        v-else-if="loading || !promotion"
        label="Loading the promotion…"
        variant="card"
      />
      <div
        v-else
        class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
      >
        <div class="min-w-0 space-y-6">
          <div class="space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                v-if="phase"
                :label="phase.label"
                :color="phase.color"
                :variant="phase.variant"
              />
              <span class="text-sm text-muted">{{ timingText(promotion, today) }}</span>
            </div>
            <p class="text-2xl font-semibold text-primary">
              {{ promotion.label }}
            </p>
            <p
              v-if="promotion.description"
              class="text-sm text-muted"
            >
              {{ promotion.description }}
            </p>
          </div>

          <section
            aria-labelledby="promotion-results"
            class="space-y-3"
          >
            <h2
              id="promotion-results"
              class="font-semibold text-highlighted"
            >
              Results
            </h2>
            <p
              v-if="promotion.phase === 'draft' || promotion.phase === 'scheduled'"
              class="rounded-lg border border-dashed border-accented p-4 text-sm text-muted"
            >
              Results appear here once customers order at its price{{ promotion.phase === 'scheduled' ? `, from ${dateText(promotion.startsOn)}` : '' }}.
            </p>
            <ApiErrorAlert
              v-else-if="resultsError"
              :error="resultsError"
              title="Could not load the results"
              @retry="refreshResults()"
            />
            <dl
              v-else
              class="grid grid-cols-2 gap-3 xl:grid-cols-4"
            >
              <StatCard
                label="Orders"
                :value="results ? String(results.orders) : '—'"
                icon="i-lucide-receipt-text"
              />
              <StatCard
                label="Items sold"
                :value="results ? String(results.units) : '—'"
                icon="i-lucide-coffee"
              />
              <StatCard
                label="Discount given"
                :value="results ? formatMinor(results.discountMinor) : '—'"
                icon="i-lucide-badge-percent"
              />
              <StatCard
                label="Sales at its price"
                :value="results ? formatMinor(results.salesMinor) : '—'"
                icon="i-lucide-banknote"
              />
            </dl>
            <p
              v-if="promotion.phase === 'live' || promotion.phase === 'ended'"
              class="text-xs text-muted"
            >
              Orders paid and not cancelled, with at least one item at this promotion's price.<template v-if="results?.bySource.telegram">
                {{ ' ' }}<strong class="text-highlighted">{{ pluralize(results.bySource.telegram, ['order', 'orders']) }} from Telegram posts.</strong>
              </template>
            </p>
          </section>

          <PromotionPostsCard
            v-if="promotion.phase !== 'draft'"
            :promotion="promotion"
          />

          <UCard variant="outline">
            <template #header>
              <h2 class="font-semibold text-highlighted">
                Details
              </h2>
            </template>
            <dl class="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-y-4 [&>dd]:max-sm:mb-3">
              <dt class="text-muted">
                Discount
              </dt>
              <dd>{{ promotion.label }} each item <span class="text-muted">· add-ons keep their price</span></dd>
              <dt class="text-muted">
                What's included
              </dt>
              <dd>
                <span v-if="promotion.scope === 'menu'">The whole menu</span>
                <ul
                  v-else
                  class="space-y-1"
                >
                  <li
                    v-for="category in promotion.categories"
                    :key="category.id"
                    class="flex items-center gap-2"
                  >
                    <UIcon
                      name="i-lucide-folder"
                      class="size-4 text-muted"
                    />
                    <span>{{ category.name }} <span class="text-muted">· every item</span></span>
                    <UBadge
                      v-if="category.status === 'archived'"
                      label="Archived"
                      color="neutral"
                      variant="subtle"
                      size="sm"
                    />
                  </li>
                  <li
                    v-for="item in promotion.items"
                    :key="item.id"
                    class="flex items-center gap-2"
                  >
                    <UIcon
                      name="i-lucide-coffee"
                      class="size-4 text-muted"
                    />
                    <span>{{ item.name }}</span>
                    <UBadge
                      v-if="item.status !== 'active'"
                      :label="item.status === 'draft' ? 'Draft' : 'Archived'"
                      color="neutral"
                      variant="subtle"
                      size="sm"
                    />
                  </li>
                </ul>
              </dd>
              <dt class="text-muted">
                When
              </dt>
              <dd>{{ whenText(promotion.startsOn, promotion.endsOn) }}</dd>
              <dt class="text-muted">
                Branches
              </dt>
              <dd>{{ promotion.branches.length ? promotion.branches.map(b => b.name).join(', ') : 'Every branch' }}</dd>
            </dl>
          </UCard>
        </div>

        <aside
          class="space-y-3"
          aria-labelledby="promotion-poster"
        >
          <UCard variant="outline">
            <template #header>
              <h2
                id="promotion-poster"
                class="font-semibold text-highlighted"
              >
                Poster
              </h2>
            </template>
            <div
              v-if="promotion.poster"
              class="space-y-3"
            >
              <img
                :src="promotion.poster.url"
                :alt="`Poster for ${promotion.name}`"
                class="w-full rounded-md ring ring-default"
              >
              <UButton
                label="Download"
                icon="i-lucide-download"
                color="neutral"
                variant="outline"
                block
                :to="promotion.poster.url"
                :download="`${promotion.name}`"
                target="_blank"
              />
            </div>
            <div
              v-else
              class="space-y-3 text-center"
            >
              <p class="text-sm text-muted">
                No poster. Add one you made in Canva or with AI: customers see it on the menu.
              </p>
              <UButton
                v-if="promotion.phase !== 'ended'"
                label="Add a poster"
                icon="i-lucide-image-plus"
                color="neutral"
                variant="outline"
                :to="tenantPath(`/admin/promotions/${promotion.id}/edit`)"
              />
            </div>
          </UCard>
        </aside>
      </div>
    </template>
  </UDashboardPanel>
</template>
