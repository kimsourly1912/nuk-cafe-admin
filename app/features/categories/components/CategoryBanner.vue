<script setup lang="ts">
/**
 * The banner over a main category's subcategories (D270): its name, description, contents and
 * availability, with Edit details and its actions. The photo is one for every category until
 * categories have their own (no field for one yet), with a version per color mode
 * (`UColorModeImage`), so the words follow the theme. It always fills the card. From `@2xl` of its
 * own width it starts from its top, so the words sit on its plain left side and the cup runs off the
 * bottom edge. Narrower the cup reaches under the words, so a veil in the page's color fades out
 * towards it. Lazy, so only the mode's version loads and the phone's list view loads neither.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MenuCategory } from '#shared/contracts/menu-categories'
import latteDark from '~/assets/img/latte-on-warm-ivory-dark.webp'
import latteLight from '~/assets/img/latte-on-warm-ivory-light.webp'
import { availabilityLabel, statusBadge } from '../schemas/category-display'

const props = defineProps<{
  category: MenuCategory
  summary: string
  actions: DropdownMenuItem[]
  /** Edit details: an active category that isn't only there as a parent of what's found. */
  editable: boolean
  showStatus: boolean
  busy?: boolean
  ruleTimes?: ReadonlyMap<string, string>
}>()

defineEmits<{ edit: [] }>()

// Vite can resolve the client import to an absolute URL; SSR must use that same form.
const origin = useRequestURL().origin
const photoLight = new URL(latteLight, origin).href
const photoDark = new URL(latteDark, origin).href
const availability = computed(() => availabilityLabel(props.category, props.ruleTimes))
</script>

<template>
  <section
    class="@container relative overflow-hidden rounded-lg border border-default bg-default"
    :aria-label="category.name"
  >
    <UColorModeImage
      :light="photoLight"
      :dark="photoDark"
      alt=""
      loading="lazy"
      class="absolute inset-0 size-full object-cover object-right @2xl:object-top"
    />
    <div class="absolute inset-0 bg-default/85 mask-r-from-60% @2xl:hidden" />
    <div class="relative flex flex-col gap-4 p-4 @2xl:min-h-48 @2xl:flex-row @2xl:items-start @2xl:justify-between @2xl:p-6">
      <div class="flex min-w-0 gap-4 @2xl:max-w-1/2">
        <div class="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 @2xl:size-16">
          <UIcon
            name="i-lucide-tags"
            class="size-6 text-highlighted"
          />
        </div>
        <div class="min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-x-2">
            <h2 class="text-xl font-semibold break-words text-highlighted">
              {{ category.name }}
            </h2>
            <UBadge
              v-if="showStatus"
              v-bind="statusBadge(category.status)"
            />
          </div>
          <p
            v-if="category.description"
            class="line-clamp-2 text-sm text-default"
          >
            {{ category.description }}
          </p>
          <p class="text-sm text-default">
            {{ summary }}
          </p>
          <UTooltip
            :text="availability.full"
            :content="{ side: 'bottom' }"
          >
            <p class="flex w-fit max-w-full items-center gap-1.5 text-sm text-default">
              <UIcon
                name="i-lucide-clock"
                class="size-4 shrink-0"
              />
              <span class="truncate">{{ availability.label }}</span>
              <span class="sr-only">{{ availability.full }}</span>
            </p>
          </UTooltip>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <UButton
          v-if="editable"
          label="Edit details"
          icon="i-lucide-pencil"
          color="neutral"
          variant="outline"
          :disabled="busy"
          @click="$emit('edit')"
        />
        <UDropdownMenu
          v-if="actions.length"
          :items="actions"
          :content="{ align: 'end' }"
        >
          <UButton
            icon="i-lucide-ellipsis-vertical"
            color="neutral"
            variant="ghost"
            :disabled="busy"
            :aria-label="`Actions for ${category.name}`"
          />
        </UDropdownMenu>
      </div>
    </div>
  </section>
</template>
