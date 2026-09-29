<script setup lang="ts">
/**
 * "Used by N menu items" on a group's page (D75): the first few items that offer the group, each
 * opening that item on the Menu items page, and "View all" opening the Menu items page filtered by
 * the group. Drafts and published items, like the library's count.
 */
import type { ModifierGroup } from '#shared/contracts/menu-modifiers'
import { USAGE_PREVIEW, useModifierGroupItems } from '../composables/useModifierGroups'

const props = defineProps<{ group: ModifierGroup }>()

const { data, loading, error, refresh } = useModifierGroupItems(props.group.id)
const total = computed(() => data.value?.total ?? props.group.itemCount)
</script>

<template>
  <section
    aria-labelledby="group-usage-heading"
    class="space-y-3"
  >
    <h2
      id="group-usage-heading"
      class="font-semibold text-highlighted"
    >
      {{ total ? `Used by ${pluralize(total, ['menu item', 'menu items'])}` : 'Not used yet' }}
    </h2>

    <ApiErrorAlert
      v-if="error"
      :error="error"
      title="Could not load the menu items"
      @retry="refresh()"
    />
    <ListSkeleton
      v-else-if="loading"
      label="Loading menu items…"
    />
    <p
      v-else-if="!data?.items.length"
      class="text-sm text-muted"
    >
      No menu item offers this group yet. Add it from a menu item's form.
    </p>
    <template v-else>
      <ul class="divide-y divide-default">
        <li
          v-for="item in data.items"
          :key="item.id"
        >
          <ULink
            :to="`/admin/products?item=${item.id}`"
            class="flex items-center gap-3 py-2.5 text-default hover:text-highlighted"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate">{{ item.name }}</span>
              <span class="block truncate text-sm text-muted">{{ item.categoryName }}</span>
            </span>
            <UBadge
              v-if="item.status === 'draft'"
              label="Draft"
              color="neutral"
              variant="subtle"
              size="sm"
            />
            <UIcon
              name="i-lucide-chevron-right"
              class="size-4 shrink-0 text-muted"
            />
          </ULink>
        </li>
      </ul>
      <UButton
        v-if="total > USAGE_PREVIEW || total > data.items.length"
        :label="`View all ${pluralize(total, ['menu item', 'menu items'])}`"
        :to="`/admin/products?modifierGroupId=${group.id}`"
        variant="link"
        trailing-icon="i-lucide-arrow-right"
        class="px-0"
      />
    </template>
  </section>
</template>
