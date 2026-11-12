import type { DropdownMenuItem } from '@nuxt/ui'
import type { CustomItemLook, CustomLook, TableLook } from '#shared/contracts/shop-layout'
import { ITEM_LOOK_KINDS } from '#shared/contracts/shop-layout'
import ItemLookFormModal from '../components/ItemLookFormModal.vue'
import LookFormModal from '../components/LookFormModal.vue'
import type { ItemCategory, ItemSpec } from '../designer/catalog'
import { BUILT_IN_LOOKS, ITEM_SPECS, LOOK_CATEGORIES } from '../designer/catalog'
import { useItemLookMutations, useItemLooks, useLookMutations, useLooks } from './useBranches'

/** One card of the looks list: a built-in look or piece, or one of the cafe's. */
export interface LookCard {
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

/** One kind of look (tables, then each chair and fixture category), with its own and built-in cards. */
export interface LookSection {
  key: 'tables' | ItemCategory
  title: string
  intro: string
  builtIn: LookCard[]
  own: LookCard[]
  newLabel: string
  create: () => void
}

/**
 * Every furniture look (D273 step 3d): the built-in ones and the cafe's own, by kind, with their
 * forms and actions. The Furniture looks page and Studio's Manage looks panel (D277) both show it,
 * so a look is edited and deleted the same way in both. Looks are cafe-wide and owners only
 * (`furniture:manage`): the server checks every request.
 */
export function useLookCatalog() {
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
      ? { kind: look.kind, finishes: look.finishes, width: look.defaultWidth, depth: look.defaultDepth, height: look.defaultHeight }
      : { kind, finishes: {}, width: spec.width, depth: spec.depth, height: spec.height }
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

  const pieceSpecs = (category: ItemCategory) => ITEM_LOOK_KINDS.map(kind => ITEM_SPECS[kind]).filter(spec => spec.category === category)
  const ownPieces = (category: ItemCategory) => (itemLooksQuery.data.value ?? []).filter(look => ITEM_SPECS[look.kind].category === category)

  const sections = computed<LookSection[]>(() => [
    {
      key: 'tables',
      title: 'Table looks',
      intro: 'A table’s shape, base, chairs and finishes. Its chairs follow the table’s seats.',
      builtIn: BUILT_IN_LOOKS.map(tableCard),
      own: (looksQuery.data.value ?? []).map(tableCard),
      newLabel: 'New table look',
      create: () => void lookModal.open({}),
    },
    ...LOOK_CATEGORIES.map(({ key, title, intro, noun }) => ({
      key,
      title,
      intro,
      builtIn: pieceSpecs(key).map(spec => pieceCard(spec)),
      own: ownPieces(key).map(look => pieceCard(ITEM_SPECS[look.kind], look)),
      newLabel: `New ${noun} look`,
      create: () => void itemLookModal.open({ category: key }),
    })),
  ])

  const newItems = computed<DropdownMenuItem[]>(() => sections.value.map(section => ({ label: section.newLabel, onSelect: section.create })))

  return { loading, error, refreshing, retry, sections, newItems }
}

export type LookCatalog = ReturnType<typeof useLookCatalog>
