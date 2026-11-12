<script setup lang="ts">
/**
 * The furniture looks list (D273 step 3d): each kind's own looks, then the built-in ones, as cards
 * with their actions. The Furniture looks page shows it full width; Studio's Manage looks panel
 * (D277) shows it in the sidebar, where the cards follow the panel's width (`@container`).
 */
import { createReusableTemplate } from '@vueuse/core'
import type { LookCard, LookCatalog } from '../composables/useLookCatalog'

const { catalog, sectionActions = true, headingLevel = 2 } = defineProps<{
  catalog: LookCatalog
  /** Each section's own New … look button. Studio's panel has one New look menu instead. */
  sectionActions?: boolean
  /** The sections' heading level: 2 on the page, 3 under Studio's panel title. */
  headingLevel?: 2 | 3
}>()
// Studio can show the list twice (its sidebar and its sheet): ids stay unique.
const id = useId()
const heading = (below = 0) => `h${headingLevel + below}`
defineSlots<{ intro?: () => unknown }>()

const [DefineCard, ReuseCard] = createReusableTemplate<{ card: LookCard }>()
</script>

<template>
  <!-- A look's card: the picture, the name (the cafe's own: opens its form), a meta line and ⋮.
       Narrower than 320 px (Studio's sidebar) it is a row with a small picture. -->
  <DefineCard v-slot="{ card }">
    <div
      class="flex h-full overflow-hidden rounded-lg border border-default bg-default @xs:flex-col"
      :data-testid="card.testid"
    >
      <img
        v-if="card.photo"
        :src="card.photo"
        alt=""
        loading="lazy"
        class="aspect-4/3 w-20 shrink-0 bg-muted object-cover @xs:w-full"
      >
      <div
        v-else
        class="flex aspect-4/3 w-20 shrink-0 items-center justify-center bg-muted @xs:w-full"
      >
        <UIcon
          :name="card.icon"
          class="size-8 text-dimmed"
        />
      </div>
      <div class="flex flex-1 items-start gap-1 p-2">
        <div class="relative flex min-w-0 flex-1 flex-col gap-0.5 py-1">
          <UButton
            v-if="card.open"
            :label="card.name"
            color="neutral"
            variant="link"
            class="justify-start p-0 text-left font-medium break-words text-highlighted after:absolute after:inset-0"
            @click="card.open()"
          />
          <span
            v-else
            class="font-medium break-words text-highlighted"
          >{{ card.name }}</span>
          <span class="text-xs text-muted">{{ card.meta }}</span>
        </div>
        <UDropdownMenu
          :items="card.actions"
          :content="{ align: 'end' }"
        >
          <UButton
            icon="i-lucide-ellipsis-vertical"
            color="neutral"
            variant="ghost"
            :aria-label="`Actions for ${card.name}`"
          />
        </UDropdownMenu>
      </div>
    </div>
  </DefineCard>

  <ApiErrorAlert
    v-if="catalog.error.value"
    :error="catalog.error.value"
    title="Could not load the looks"
    @retry="catalog.retry()"
  />
  <ListSkeleton
    v-else-if="catalog.loading.value"
    label="Loading the looks"
    variant="card"
    :count="6"
  />
  <div
    v-else
    class="@container flex flex-col gap-8"
  >
    <p class="text-sm text-muted">
      Looks are shared by every branch. Editing one changes every table or piece that uses it; one in use can’t be deleted.
      <slot name="intro" />
    </p>

    <section
      v-for="section in catalog.sections.value"
      :key="section.key"
      :aria-labelledby="`${id}-looks-${section.key}`"
      class="flex flex-col gap-3"
      :data-testid="`looks-${section.key}`"
    >
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <component
            :is="heading()"
            :id="`${id}-looks-${section.key}`"
            class="text-base font-semibold text-highlighted"
          >
            {{ section.title }}
          </component>
          <p class="text-sm text-muted">
            {{ section.intro }}
          </p>
        </div>
        <UButton
          v-if="sectionActions"
          :label="section.newLabel"
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          size="sm"
          @click="section.create()"
        />
      </div>

      <component
        :is="heading(1)"
        class="text-xs font-semibold tracking-wide text-muted uppercase"
      >
        Your looks
      </component>
      <p
        v-if="!section.own.length"
        class="text-sm text-muted"
      >
        None yet. Start one with {{ section.newLabel }}, or from a built-in one below.
      </p>
      <ul
        v-else
        class="grid grid-cols-1 gap-2 @xs:grid-cols-2 @xs:gap-3 @lg:grid-cols-3 @2xl:grid-cols-4 @4xl:grid-cols-5"
        :aria-label="`Your ${section.title.toLowerCase()}`"
      >
        <li
          v-for="card in section.own"
          :key="card.key"
        >
          <ReuseCard :card="card" />
        </li>
      </ul>

      <component
        :is="heading(1)"
        class="text-xs font-semibold tracking-wide text-muted uppercase"
      >
        Built in
      </component>
      <ul
        class="grid grid-cols-1 gap-2 @xs:grid-cols-2 @xs:gap-3 @lg:grid-cols-3 @2xl:grid-cols-4 @4xl:grid-cols-5"
        :aria-label="`Built-in ${section.title.toLowerCase()}`"
      >
        <li
          v-for="card in section.builtIn"
          :key="card.key"
        >
          <ReuseCard :card="card" />
        </li>
      </ul>
    </section>
  </div>
</template>
