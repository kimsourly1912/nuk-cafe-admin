<script setup lang="ts">
/**
 * The menu's offers (M1, D163): each live promotion as a card with its poster, badge and last day,
 * in a row that scrolls sideways on phones. A card opens the offer: the poster large, its words,
 * and the items at its price, each opening the item to add it. Rendered on the server like the
 * rest of the menu; the sheet or dialog is chosen by width only when opened.
 */
import { AppDrawer, UModal } from '#components'
import type { PublicPromotion } from '#shared/contracts/menu-promotions'
import type { PublicMenuItem } from '#shared/contracts/public-menu'
import type { MenuSection } from '../utils/menu'
import { groupItemsByCategory, priceOf } from '../utils/menu'

const props = defineProps<{
  promotions: PublicPromotion[]
  /** The menu now: an offer's items are grouped by the category they sit in. */
  sections: MenuSection[]
}>()
const emit = defineEmits<{ 'open-item': [item: PublicMenuItem] }>()

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const until = (endsOn: string | null) => (endsOn ? `Until ${Number(endsOn.slice(8, 10))} ${MONTHS[Number(endsOn.slice(5, 7)) - 1]}` : null)

const { isCompact } = useLayoutContext()
const Shell = computed(() => (isCompact.value ? AppDrawer : UModal))
const open = ref(false)
const shown = shallowRef<PublicPromotion>()
const shownGroups = computed(() => groupItemsByCategory(props.sections, shown.value?.itemIds ?? []))

function show(promotion: PublicPromotion) {
  shown.value = promotion
  open.value = true
}

/** Opens an offer by id (a channel post's `?promo=`, M2a); whether it is on the menu now. */
function showById(id: string): boolean {
  const promotion = props.promotions.find(candidate => candidate.id === id)
  if (promotion) show(promotion)
  return !!promotion
}
defineExpose({ showById })

function openItem(item: PublicMenuItem) {
  open.value = false
  emit('open-item', item)
}
</script>

<template>
  <section
    aria-labelledby="menu-offers"
    class="space-y-3"
  >
    <h2
      id="menu-offers"
      class="text-xl font-semibold text-highlighted"
    >
      Offers
    </h2>
    <ul class="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3">
      <li
        v-for="promotion in promotions"
        :key="promotion.id"
        class="w-[85%] shrink-0 snap-start sm:w-auto"
      >
        <article class="relative flex h-full gap-3 rounded-lg border border-default bg-default p-3">
          <div class="aspect-4/5 w-20 shrink-0 overflow-hidden rounded-md bg-elevated">
            <img
              v-if="promotion.posterUrl"
              :src="promotion.posterUrl"
              alt=""
              loading="lazy"
              class="size-full object-cover"
            >
            <div
              v-else
              class="flex size-full items-center justify-center bg-error/10 text-error"
            >
              <UIcon
                name="i-lucide-badge-percent"
                class="size-7"
              />
            </div>
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <UBadge
              :label="promotion.label"
              color="error"
              variant="solid"
              size="sm"
              class="self-start"
            />
            <h3 class="font-semibold text-highlighted">
              <button
                type="button"
                class="text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-primary"
                @click="show(promotion)"
              >
                {{ promotion.name }}
              </button>
            </h3>
            <p
              v-if="promotion.description"
              class="line-clamp-2 text-sm text-muted"
            >
              {{ promotion.description }}
            </p>
            <p class="mt-auto text-xs text-muted">
              {{ [pluralize(promotion.itemIds.length, ['item', 'items']), until(promotion.endsOn)].filter(Boolean).join(' · ') }}
            </p>
          </div>
        </article>
      </li>
    </ul>

    <component
      :is="Shell"
      v-model:open="open"
      :title="shown?.name"
      :description="shown?.description || shown?.label"
      :ui="isCompact ? { content: 'max-h-[92dvh]', body: 'overflow-y-auto' } : { content: 'sm:max-w-lg' }"
    >
      <template #body>
        <div
          v-if="shown"
          class="space-y-4"
        >
          <img
            v-if="shown.posterUrl"
            :src="shown.posterUrl"
            :alt="`Poster: ${shown.name}`"
            class="mx-auto max-h-[60dvh] w-auto rounded-lg"
          >
          <div class="flex flex-wrap items-center gap-2">
            <UBadge
              :label="shown.label"
              color="error"
              variant="solid"
            />
            <span
              v-if="until(shown.endsOn)"
              class="text-sm text-muted"
            >{{ until(shown.endsOn) }}</span>
          </div>
          <section
            v-for="group in shownGroups"
            :key="group.id"
            :aria-labelledby="`offer-group-${group.id}`"
            class="space-y-2"
          >
            <h3
              :id="`offer-group-${group.id}`"
              class="text-sm font-semibold text-highlighted"
            >
              {{ group.name }}
            </h3>
            <ul
              class="grid grid-cols-2 gap-3"
              :aria-label="`${group.name} in ${shown.name}`"
            >
              <li
                v-for="item in group.items"
                :key="item.id"
              >
                <button
                  type="button"
                  class="flex h-full w-full items-start gap-3 rounded-lg border border-default p-2 text-left focus-visible:outline-2 focus-visible:outline-primary"
                  @click="openItem(item)"
                >
                  <MenuItemImage
                    :image="item.image"
                    :src="item.imageUrl"
                    usage="card"
                    class="size-10 shrink-0 rounded-md"
                  />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="line-clamp-2 text-sm font-medium text-highlighted">{{ item.name }}</span>
                    <span class="flex flex-wrap items-baseline gap-x-1.5 text-sm tabular-nums">
                      <span class="font-semibold text-error">{{ formatMinor(priceOf(item).minor) }}</span>
                      <s
                        v-if="priceOf(item).regularMinor !== null"
                        class="text-xs text-muted"
                      ><span class="sr-only">was </span>{{ formatMinor(priceOf(item).regularMinor) }}</s>
                    </span>
                  </span>
                </button>
              </li>
            </ul>
          </section>
        </div>
      </template>
    </component>
  </section>
</template>
