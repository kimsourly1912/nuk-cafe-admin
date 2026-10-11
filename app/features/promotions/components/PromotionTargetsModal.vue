<script setup lang="ts">
/**
 * "Choose what's included" (M1, D163): the menu as a checklist. Ticking a category covers all of
 * its items, now and later (a main category: its sub-categories too), and its items show as
 * included; ticking items picks them one by one. Search finds items and categories by name. Open
 * via `useOverlay().create(PromotionTargetsModal)`; emits `close({ itemIds, categoryIds })`, or
 * nothing on Cancel.
 */
import type { PickerCategory } from '../schemas/promotion-form'

const props = defineProps<{
  tree: PickerCategory[]
  itemIds: string[]
  categoryIds: string[]
}>()
const emit = defineEmits<{ close: [chosen?: { itemIds: string[], categoryIds: string[] }] }>()

const { isCompact: fullscreen } = useLayoutContext()
const items = ref(new Set(props.itemIds))
const categories = ref(new Set(props.categoryIds))
const search = ref('')

const term = computed(() => search.value.trim().toLocaleLowerCase())
const matches = (name: string) => !term.value || name.toLocaleLowerCase().includes(term.value)

/** The tree narrowed by the search: a category that matches keeps all its items. */
const shown = computed(() => props.tree.flatMap((main) => {
  if (matches(main.name)) return [main]
  const subs = main.subs.flatMap(sub => (matches(sub.name) ? [sub] : sub.items.some(i => matches(i.name)) ? [{ ...sub, items: sub.items.filter(i => matches(i.name)) }] : []))
  const own = main.items.filter(i => matches(i.name))
  return subs.length || own.length ? [{ ...main, subs, items: own }] : []
}))

function toggle(set: Set<string>, id: string, on: boolean) {
  const next = new Set(set)
  if (on) next.add(id)
  else next.delete(id)
  return next
}

/** A category's items are covered by it, or by its main category. */
const coveredBy = (main: PickerCategory, sub?: PickerCategory) => categories.value.has(main.id) || (!!sub && categories.value.has(sub.id))

const count = computed(() => items.value.size + categories.value.size)
const summary = computed(() => {
  const parts = [
    categories.value.size ? pluralize(categories.value.size, ['category', 'categories']) : '',
    items.value.size ? pluralize(items.value.size, ['item', 'items']) : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' and ') : 'Nothing chosen yet'
})

function done() {
  emit('close', { itemIds: [...items.value], categoryIds: [...categories.value] })
}
</script>

<template>
  <UModal
    :fullscreen="fullscreen"
    title="Choose what's included"
    description="Tick a category to include everything in it, also items you add later, or tick items one by one."
    :ui="{ content: 'sm:max-w-xl', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <div class="sticky top-0 z-10 border-b border-default bg-default p-4">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search items or categories…"
          aria-label="Search items or categories"
          class="w-full"
        />
      </div>
      <p
        v-if="!shown.length"
        class="p-6 text-center text-sm text-muted"
      >
        {{ tree.length ? `Nothing matches “${search.trim()}”` : 'Your menu has no categories yet.' }}
      </p>
      <ul
        v-else
        class="divide-y divide-default"
        aria-label="Menu"
      >
        <li
          v-for="main in shown"
          :key="main.id"
          class="py-2"
        >
          <UCheckbox
            :model-value="categories.has(main.id)"
            :label="main.name"
            :description="main.subs.length ? 'The whole category, every sub-category' : 'The whole category'"
            :ui="{ root: 'px-4 py-2', label: 'font-semibold text-highlighted' }"
            @update:model-value="on => categories = toggle(categories, main.id, !!on)"
          />
          <ul
            v-if="main.items.length"
            class="pl-8"
          >
            <li
              v-for="item in main.items"
              :key="item.id"
            >
              <UCheckbox
                :model-value="coveredBy(main) || items.has(item.id)"
                :disabled="coveredBy(main)"
                :ui="{ root: 'px-4 py-1.5', wrapper: 'flex-1 min-w-0' }"
                :aria-label="item.name"
                @update:model-value="on => items = toggle(items, item.id, !!on)"
              >
                <template #label>
                  <span class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate">{{ item.name }}</span>
                    <UBadge
                      v-if="item.draft"
                      label="Draft"
                      color="neutral"
                      variant="subtle"
                      size="sm"
                    />
                    <span class="shrink-0 text-muted tabular-nums">{{ formatMinor(item.priceMinMinor) }}</span>
                  </span>
                </template>
              </UCheckbox>
            </li>
          </ul>
          <div
            v-for="sub in main.subs"
            :key="sub.id"
            class="pl-6"
          >
            <UCheckbox
              :model-value="coveredBy(main) || categories.has(sub.id)"
              :disabled="coveredBy(main)"
              :label="sub.name"
              :ui="{ root: 'px-4 py-1.5', label: 'font-medium text-highlighted' }"
              @update:model-value="on => categories = toggle(categories, sub.id, !!on)"
            />
            <ul class="pl-8">
              <li
                v-for="item in sub.items"
                :key="item.id"
              >
                <UCheckbox
                  :model-value="coveredBy(main, sub) || items.has(item.id)"
                  :disabled="coveredBy(main, sub)"
                  :ui="{ root: 'px-4 py-1.5', wrapper: 'flex-1 min-w-0' }"
                  :aria-label="item.name"
                  @update:model-value="on => items = toggle(items, item.id, !!on)"
                >
                  <template #label>
                    <span class="flex items-center gap-2">
                      <span class="min-w-0 flex-1 truncate">{{ item.name }}</span>
                      <UBadge
                        v-if="item.draft"
                        label="Draft"
                        color="neutral"
                        variant="subtle"
                        size="sm"
                      />
                      <span class="shrink-0 text-muted tabular-nums">{{ formatMinor(item.priceMinMinor) }}</span>
                    </span>
                  </template>
                </UCheckbox>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </template>

    <template #footer>
      <div class="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
        <p
          class="min-w-0 flex-1 text-sm text-muted"
          aria-live="polite"
        >
          {{ summary }}
        </p>
        <div class="flex gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            class="flex-1 justify-center sm:flex-none"
            @click="emit('close')"
          />
          <UButton
            label="Done"
            class="flex-1 justify-center sm:flex-none"
            :disabled="!count"
            @click="done"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
