<script setup lang="ts">
/**
 * `/admin/branches/looks` (D273, step 3d): every furniture look in one place, outside the editor.
 * The built-in looks and pieces with their pictures (start a new look from one), and the cafe's
 * own table, chair and fixture looks: edit, start another from one, or delete one no saved layout
 * uses. Looks are cafe-wide, so this page belongs to no branch. Owners only (`furniture:manage`).
 */
import { createReusableTemplate } from '@vueuse/core'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { CustomItemLook, CustomLook, TableLook } from '#shared/contracts/shop-layout'
import { ITEM_LOOK_KINDS } from '#shared/contracts/shop-layout'
import type { ItemCategory, ItemSpec } from '../designer/catalog'
import { BUILT_IN_LOOKS, ITEM_SPECS } from '../designer/catalog'
import { useItemLookMutations, useItemLooks, useLookMutations, useLooks } from '../composables/useBranches'
import ItemLookFormModal from './ItemLookFormModal.vue'
import LookFormModal from './LookFormModal.vue'

const tenantPath = useTenantPath()
const looksQuery = useLooks()
const itemLooksQuery = useItemLooks()
// Both lists decide which cards each section shows (D238): one skeleton until both answer.
const loading = computed(() => looksQuery.loading.value || itemLooksQuery.loading.value)
const error = computed(() => looksQuery.error.value ?? itemLooksQuery.error.value)
const refreshing = computed(() => looksQuery.refreshing.value || itemLooksQuery.refreshing.value)

function retry() {
  if (looksQuery.error.value) void looksQuery.refresh()
  if (itemLooksQuery.error.value) void itemLooksQuery.refresh()
}

const overlay = useOverlay()
const lookModal = overlay.create(LookFormModal)
const itemLookModal = overlay.create(ItemLookFormModal)
const { remove: removeLook } = useLookMutations()
const { remove: removeItemLook } = useItemLookMutations()

const LOOK_ICONS = { round: 'i-lucide-circle', rect: 'i-lucide-rectangle-horizontal', booth: 'i-lucide-sofa' } as const
const sizeOf = (round: boolean, width: number, depth: number) => (round ? `Ø ${width} cm` : `${width} × ${depth} cm`)
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** One card on the page: a built-in look or piece, or one of the cafe's. */
interface LookCard {
  key: string
  name: string
  photo: string | null
  icon: string
  meta: string
  /** The cafe's own: opens its form. Built in: none (it can't change). */
  open?: () => void
  actions: DropdownMenuItem[]
  testid: string
}

function tableCard(look: TableLook): LookCard {
  const custom = 'version' in look ? look as CustomLook : null
  const size = sizeOf(look.shape === 'round', look.defaultWidth, look.defaultDepth)
  const startFrom: DropdownMenuItem = { label: 'New look from this', icon: 'i-lucide-copy-plus', onSelect: () => void lookModal.open({ from: look }) }
  return {
    key: look.id,
    name: look.name,
    photo: look.photo?.url ?? null,
    icon: LOOK_ICONS[look.shape],
    meta: custom ? `${size} · ${custom.tables ? `Used by ${plural(custom.tables, 'table', 'tables')}` : 'Not used'}` : `${size} · Built in`,
    open: custom ? () => void lookModal.open({ look: custom }) : undefined,
    actions: custom
      ? [
          { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => void lookModal.open({ look: custom }) },
          startFrom,
          { label: custom.tables ? 'Delete (in use)' : 'Delete', icon: 'i-lucide-trash-2', color: 'error', disabled: custom.tables > 0, onSelect: () => void removeLook.execute({ look: custom }) },
        ]
      : [startFrom],
    testid: custom ? `look-card-${look.name}` : `look-card-${look.id}`,
  }
}

function pieceCard(spec: ItemSpec, look?: CustomItemLook): LookCard {
  const round = spec.footprint === 'round'
  const kind = spec.kind as CustomItemLook['kind']
  const from = look
    ? { kind: look.kind, finishes: look.finishes, width: look.defaultWidth, depth: look.defaultDepth }
    : { kind, finishes: {}, width: spec.width, depth: spec.depth }
  const startFrom: DropdownMenuItem = { label: 'New look from this', icon: 'i-lucide-copy-plus', onSelect: () => void itemLookModal.open({ from }) }
  if (!look) {
    return { key: spec.kind, name: spec.label, photo: spec.photo, icon: 'i-lucide-armchair', meta: `${sizeOf(round, spec.width, spec.depth)} · Built in`, actions: [startFrom], testid: `look-card-${spec.kind}` }
  }
  return {
    key: look.id,
    name: look.name,
    photo: look.photo?.url ?? null,
    icon: 'i-lucide-armchair',
    meta: `${spec.label} · ${sizeOf(round, look.defaultWidth, look.defaultDepth)} · ${look.pieces ? `Used by ${plural(look.pieces, 'piece', 'pieces')}` : 'Not used'}`,
    open: () => void itemLookModal.open({ look }),
    actions: [
      { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => void itemLookModal.open({ look }) },
      startFrom,
      { label: look.pieces ? 'Delete (in use)' : 'Delete', icon: 'i-lucide-trash-2', color: 'error', disabled: look.pieces > 0, onSelect: () => void removeItemLook.execute({ look }) },
    ],
    testid: `look-card-${look.name}`,
  }
}

interface Section {
  key: 'tables' | ItemCategory
  title: string
  intro: string
  builtIn: LookCard[]
  own: LookCard[]
  newLabel: string
  create: () => void
}

const pieceSpecs = (category: ItemCategory) => ITEM_LOOK_KINDS.map(kind => ITEM_SPECS[kind]).filter(spec => spec.category === category)
const ownPieces = (category: ItemCategory) => (itemLooksQuery.data.value ?? []).filter(look => ITEM_SPECS[look.kind].category === category)

const sections = computed<Section[]>(() => [
  {
    key: 'tables',
    title: 'Table looks',
    intro: 'A table’s shape, base, chairs and finishes. Its chairs follow the table’s seats.',
    builtIn: BUILT_IN_LOOKS.map(tableCard),
    own: (looksQuery.data.value ?? []).map(tableCard),
    newLabel: 'New table look',
    create: () => void lookModal.open({}),
  },
  ...(['chairs', 'fixtures'] as const).map(category => ({
    key: category,
    title: category === 'chairs' ? 'Chairs' : 'Fixtures',
    intro: category === 'chairs' ? 'Stools, benches and chairs placed on their own, not around a table.' : 'Counters, shelves, plants and dividers.',
    builtIn: pieceSpecs(category).map(spec => pieceCard(spec)),
    own: ownPieces(category).map(look => pieceCard(ITEM_SPECS[look.kind], look)),
    newLabel: category === 'chairs' ? 'New chair look' : 'New fixture look',
    create: () => void itemLookModal.open({ category }),
  })),
])

const [DefineCard, ReuseCard] = createReusableTemplate<{ card: LookCard }>()

const newItems = computed<DropdownMenuItem[]>(() => sections.value.map(section => ({ label: section.newLabel, onSelect: section.create })))
</script>

<template>
  <!-- A look's card: the picture, the name (the cafe's own: opens its form), a meta line and ⋮. -->
  <DefineCard v-slot="{ card }">
    <div
      class="flex h-full flex-col overflow-hidden rounded-lg border border-default bg-default"
      :data-testid="card.testid"
    >
      <img
        v-if="card.photo"
        :src="card.photo"
        alt=""
        loading="lazy"
        class="aspect-4/3 w-full bg-muted object-cover"
      >
      <div
        v-else
        class="flex aspect-4/3 w-full items-center justify-center bg-muted"
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

  <UDashboardPanel id="furniture-looks">
    <template #header>
      <UDashboardNavbar title="Furniture looks">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UDropdownMenu
            :items="newItems"
            :content="{ align: 'end' }"
          >
            <UButton
              label="New look"
              icon="i-lucide-plus"
              trailing-icon="i-lucide-chevron-down"
              :disabled="loading || Boolean(error)"
            />
          </UDropdownMenu>
        </template>
      </UDashboardNavbar>
      <RefreshBar :active="refreshing" />
    </template>

    <template #body>
      <ApiErrorAlert
        v-if="error"
        :error="error"
        title="Could not load the looks"
        @retry="retry()"
      />
      <ListSkeleton
        v-else-if="loading"
        label="Loading the looks"
        variant="card"
        :count="6"
      />
      <div
        v-else
        class="flex flex-col gap-8"
      >
        <p class="text-sm text-muted">
          Looks are shared by every branch. Editing one changes every table or piece that uses it; one in use can’t be deleted.
          Place them in a branch’s
          <ULink
            :to="tenantPath('/admin/branches')"
            class="text-primary"
          >Dining tables → Design shop</ULink>.
        </p>

        <section
          v-for="section in sections"
          :key="section.key"
          :aria-labelledby="`looks-${section.key}`"
          class="flex flex-col gap-3"
          :data-testid="`looks-${section.key}`"
        >
          <div class="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2
                :id="`looks-${section.key}`"
                class="text-base font-semibold text-highlighted"
              >
                {{ section.title }}
              </h2>
              <p class="text-sm text-muted">
                {{ section.intro }}
              </p>
            </div>
            <UButton
              :label="section.newLabel"
              icon="i-lucide-plus"
              color="neutral"
              variant="outline"
              size="sm"
              @click="section.create()"
            />
          </div>

          <h3 class="text-xs font-semibold tracking-wide text-muted uppercase">
            Your looks
          </h3>
          <p
            v-if="!section.own.length"
            class="text-sm text-muted"
          >
            None yet. Start one with {{ section.newLabel }}, or from a built-in one below.
          </p>
          <ul
            v-else
            class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
            :aria-label="`Your ${section.title.toLowerCase()}`"
          >
            <li
              v-for="card in section.own"
              :key="card.key"
            >
              <ReuseCard :card="card" />
            </li>
          </ul>

          <h3 class="text-xs font-semibold tracking-wide text-muted uppercase">
            Built in
          </h3>
          <ul
            class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
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
  </UDashboardPanel>
</template>
