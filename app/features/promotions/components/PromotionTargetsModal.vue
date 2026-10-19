<script setup lang="ts">
/**
 * "Choose what's included" (M1, D163): the menu as a checklist. Ticking a category covers all of
 * its items, now and later (a main category: its sub-categories too), and its items show as
 * included; ticking items picks them one by one. A category whose items are all ticked one by one
 * shows ticked too, but stays those items: an item added to it later isn't included unless the
 * category itself is ticked. Search finds items and categories by name. Open
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

/** A category's items are covered by it, or by its main category. */
const coveredBy = (main: PickerCategory, sub?: PickerCategory) => categories.value.has(main.id) || (!!sub && categories.value.has(sub.id))

/** The whole tree by id, so a search that hides a ticked item doesn't hide it from the parent's state. */
const fullMain = computed(() => new Map(props.tree.map(main => [main.id, main])))
const fullSub = computed(() => new Map(props.tree.flatMap(main => main.subs.map(sub => [sub.id, sub] as const))))

/** Every item under a sub-category is ticked one by one (it has at least one). */
function everySubItem(sub: PickerCategory) {
  const full = fullSub.value.get(sub.id) ?? sub
  return full.items.length > 0 && full.items.every(i => items.value.has(i.id))
}
/** Everything under a main category is ticked, by item or by sub-category, without the category itself. */
function everyMainItem(main: PickerCategory) {
  const full = fullMain.value.get(main.id) ?? main
  return (full.items.length > 0 || full.subs.length > 0)
    && full.items.every(i => items.value.has(i.id))
    && full.subs.every(sub => categories.value.has(sub.id) || everySubItem(sub))
}

/**
 * A category's box: ticked when it's chosen or everything under it is, dashed when only some of it
 * is. Ticked by its items alone it still saves only those items (see `normalize`).
 */
function mainState(main: PickerCategory): boolean | 'indeterminate' {
  if (categories.value.has(main.id) || everyMainItem(main)) return true
  const full = fullMain.value.get(main.id) ?? main
  const some = full.items.some(i => items.value.has(i.id))
    || full.subs.some(sub => categories.value.has(sub.id) || sub.items.some(i => items.value.has(i.id)))
  return some ? 'indeterminate' : false
}
function subState(main: PickerCategory, sub: PickerCategory): boolean | 'indeterminate' {
  if (coveredBy(main) || categories.value.has(sub.id) || everySubItem(sub)) return true
  const full = fullSub.value.get(sub.id) ?? sub
  return full.items.some(i => items.value.has(i.id)) ? 'indeterminate' : false
}

/** Under a box ticked by its items alone, says that new items aren't included. */
const ITEMS_ONLY = 'Every item now, not ones added later'
function mainDescription(main: PickerCategory) {
  if (!categories.value.has(main.id) && everyMainItem(main)) return ITEMS_ONLY
  return main.subs.length ? 'The whole category, every sub-category' : 'The whole category'
}
const subDescription = (main: PickerCategory, sub: PickerCategory) =>
  !coveredBy(main, sub) && everySubItem(sub) ? ITEMS_ONLY : undefined

const itemIdsUnder = (category: PickerCategory) => [...category.items, ...category.subs.flatMap(sub => sub.items)].map(i => i.id)

/**
 * Keeps nothing under a ticked category as its own tick. Items all ticked one by one are never
 * turned into their category: that would also include items added to it later, a wider discount
 * than anyone chose.
 */
function normalize(cats: Set<string>, its: Set<string>) {
  for (const main of props.tree) {
    if (cats.has(main.id)) {
      for (const sub of main.subs) cats.delete(sub.id)
      for (const id of itemIdsUnder(main)) its.delete(id)
    }
    else {
      for (const sub of main.subs) {
        if (cats.has(sub.id)) for (const i of sub.items) its.delete(i.id)
      }
    }
  }
  categories.value = cats
  items.value = its
}

/**
 * Something covered by a ticked category is being unticked: the category steps aside and what is
 * left of it is ticked one by one ("everything except Cortado"), a sub-category staying whole.
 */
function release(cats: Set<string>, its: Set<string>, main: PickerCategory, sub?: PickerCategory) {
  if (cats.has(main.id)) {
    cats.delete(main.id)
    for (const i of main.items) its.add(i.id)
    for (const s of main.subs) cats.add(s.id)
  }
  if (sub && cats.has(sub.id) && sub.items.length) {
    // Only an item is unticked inside it: the sub-category gives way to its items too.
    cats.delete(sub.id)
    for (const i of sub.items) its.add(i.id)
  }
}

/** A category's own box: sets everything under it the same way. */
function setCategory(category: PickerCategory, on: boolean, parent?: PickerCategory) {
  const full = fullMain.value.get(category.id) ?? fullSub.value.get(category.id) ?? category
  const cats = new Set(categories.value)
  const its = new Set(items.value)
  if (!on && parent) release(cats, its, fullMain.value.get(parent.id) ?? parent)
  for (const sub of full.subs) cats.delete(sub.id)
  for (const id of itemIdsUnder(full)) its.delete(id)
  if (on) cats.add(category.id)
  else cats.delete(category.id)
  normalize(cats, its)
}

/** An item's box, inside `main` or its sub-category `sub`. */
function setItem(id: string, on: boolean, main: PickerCategory, sub?: PickerCategory) {
  const cats = new Set(categories.value)
  const its = new Set(items.value)
  if (on) {
    its.add(id)
  }
  else {
    const fullM = fullMain.value.get(main.id) ?? main
    release(cats, its, fullM, sub && (fullSub.value.get(sub.id) ?? sub))
    its.delete(id)
  }
  normalize(cats, its)
}

// Open on the simplest form of what was saved, without categories or items the menu no longer has.
{
  const knownCategories = new Set(props.tree.flatMap(main => [main.id, ...main.subs.map(sub => sub.id)]))
  const knownItems = new Set(props.tree.flatMap(itemIdsUnder))
  normalize(new Set(props.categoryIds.filter(id => knownCategories.has(id))), new Set(props.itemIds.filter(id => knownItems.has(id))))
}

const count = computed(() => items.value.size + categories.value.size)
/** How many items are included in all, however they got ticked. */
const covered = computed(() => props.tree.reduce((total, main) =>
  total
  + main.items.filter(i => coveredBy(main) || items.value.has(i.id)).length
  + main.subs.reduce((n, sub) => n + sub.items.filter(i => coveredBy(main, sub) || items.value.has(i.id)).length, 0), 0))
const summary = computed(() => {
  if (!count.value) return 'Nothing chosen yet'
  const whole = categories.value.size ? ` · ${pluralize(categories.value.size, ['whole category', 'whole categories'])}` : ''
  return `${pluralize(covered.value, ['item', 'items'])} included${whole}`
})

function done() {
  emit('close', { itemIds: [...items.value], categoryIds: [...categories.value] })
}
</script>

<template>
  <UModal
    :fullscreen="fullscreen"
    title="Choose what's included"
    :ui="{ content: 'sm:max-w-xl', body: 'p-0 sm:p-0' }"
  >
    <template #description>
      <span class="sr-only">Tick a category to include everything in it, also items you add later, or tick items one by one.</span>
    </template>
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
            :model-value="mainState(main)"
            :label="main.name"
            :description="mainDescription(main)"
            :ui="{ root: 'px-4 py-2', label: 'font-semibold text-highlighted' }"
            @update:model-value="on => setCategory(main, !!on)"
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
                :ui="{ root: 'px-4 py-1.5', wrapper: 'flex-1 min-w-0' }"
                :aria-label="item.name"
                @update:model-value="on => setItem(item.id, !!on, main)"
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
              :model-value="subState(main, sub)"
              :label="sub.name"
              :description="subDescription(main, sub)"
              :ui="{ root: 'px-4 py-1.5', label: 'font-medium text-highlighted' }"
              @update:model-value="on => setCategory(sub, !!on, main)"
            />
            <ul class="pl-8">
              <li
                v-for="item in sub.items"
                :key="item.id"
              >
                <UCheckbox
                  :model-value="coveredBy(main, sub) || items.has(item.id)"
                  :ui="{ root: 'px-4 py-1.5', wrapper: 'flex-1 min-w-0' }"
                  :aria-label="item.name"
                  @update:model-value="on => setItem(item.id, !!on, main, sub)"
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
