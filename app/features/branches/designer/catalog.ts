import type { Finish, ItemKind, ItemLook, LayoutItem, TableLook } from '#shared/contracts/shop-layout'

/**
 * What the shop designer can place and how it looks (D273). The 2D editor and the 3D builders both
 * read this, so a kind's footprint and its model always agree. Pure data: no three.js here.
 */

export type FinishMaterial = 'wood' | 'metal' | 'fabric' | 'stone'

export interface FinishSwatch {
  label: string
  /** The base color (sRGB hex); the 3D material adds grain, weave or speckle on top. */
  color: string
  material: FinishMaterial
}

export const FINISH_SWATCHES: Record<Finish, FinishSwatch> = {
  'warm-oak': { label: 'Warm oak', color: '#b9773e', material: 'wood' },
  'walnut': { label: 'Walnut', color: '#6b4428', material: 'wood' },
  'pale-oak': { label: 'Pale oak', color: '#d9b98c', material: 'wood' },
  'dark-wood': { label: 'Dark wood', color: '#3f2a1c', material: 'wood' },
  'graphite': { label: 'Graphite', color: '#2f2e2c', material: 'metal' },
  'steel': { label: 'Steel', color: '#9a9792', material: 'metal' },
  'brass': { label: 'Brass', color: '#b8902f', material: 'metal' },
  'olive': { label: 'Olive', color: '#5f6b33', material: 'fabric' },
  'linen': { label: 'Linen', color: '#d8cdb8', material: 'fabric' },
  'chocolate': { label: 'Chocolate', color: '#4a3426', material: 'fabric' },
  'terracotta': { label: 'Terracotta', color: '#b0532c', material: 'fabric' },
  'navy': { label: 'Navy', color: '#2e4057', material: 'fabric' },
  'limestone': { label: 'Limestone', color: '#d9cbb1', material: 'stone' },
  'taupe-stone': { label: 'Taupe stone', color: '#9c8f80', material: 'stone' },
  'black-stone': { label: 'Black stone', color: '#26252a', material: 'stone' },
  'white-marble': { label: 'White marble', color: '#ece8e1', material: 'stone' },
}

const WOODS: Finish[] = ['warm-oak', 'walnut', 'pale-oak', 'dark-wood']
const METALS: Finish[] = ['graphite', 'steel', 'brass']
const FABRICS: Finish[] = ['olive', 'linen', 'chocolate', 'terracotta', 'navy']
const STONES: Finish[] = ['limestone', 'taupe-stone', 'black-stone', 'white-marble']

export interface FinishSlot {
  key: string
  label: string
  options: Finish[]
  default: Finish
}

export type ItemCategory = 'chairs' | 'fixtures' | 'structure'

export interface ItemSpec {
  kind: ItemKind
  label: string
  category: ItemCategory
  /** How the editor draws it from above. */
  footprint: 'rect' | 'round'
  width: number
  depth: number
  /** Its height in 3D (stairs: the floor's height). */
  height: number
  slots: FinishSlot[]
  /** The picture it ships with (step 3d, `BUILT_IN_PHOTO`); stairs have none. */
  photo: string | null
}

/**
 * Where a built-in look's or piece's picture is served (step 3d): a static file of the app's
 * (`public/shop-designer/looks/`), rendered from the same models the building uses by
 * `scripts/render-look-photos.mjs`. Not an upload: no cafe owns it.
 */
export const BUILT_IN_PHOTO = (id: string) => `/shop-designer/looks/${id}.webp`

const frame = (fallback: Finish, options: Finish[] = WOODS): FinishSlot => ({ key: 'frame', label: 'Frame', options, default: fallback })
const seat = (fallback: Finish): FinishSlot => ({ key: 'seat', label: 'Upholstery', options: FABRICS, default: fallback })

export const ITEM_SPECS: Record<ItemKind, ItemSpec> = {
  'cafe-chair': { kind: 'cafe-chair', label: 'Café chair', category: 'chairs', footprint: 'rect', width: 48, depth: 53, height: 82, slots: [frame('warm-oak'), seat('olive')], photo: BUILT_IN_PHOTO('cafe-chair') },
  'bentwood-chair': { kind: 'bentwood-chair', label: 'Bentwood chair', category: 'chairs', footprint: 'rect', width: 44, depth: 50, height: 88, slots: [frame('walnut')], photo: BUILT_IN_PHOTO('bentwood-chair') },
  'bar-stool': { kind: 'bar-stool', label: 'Bar stool', category: 'chairs', footprint: 'round', width: 40, depth: 40, height: 75, slots: [frame('warm-oak', [...WOODS, ...METALS]), seat('olive')], photo: BUILT_IN_PHOTO('bar-stool') },
  'dining-bench': { kind: 'dining-bench', label: 'Dining bench', category: 'chairs', footprint: 'rect', width: 140, depth: 40, height: 46, slots: [frame('warm-oak'), seat('olive')], photo: BUILT_IN_PHOTO('dining-bench') },
  'service-counter': { kind: 'service-counter', label: 'Service counter', category: 'fixtures', footprint: 'rect', width: 180, depth: 65, height: 92, slots: [{ key: 'cabinet', label: 'Cabinet', options: WOODS, default: 'warm-oak' }, { key: 'top', label: 'Countertop', options: STONES, default: 'limestone' }], photo: BUILT_IN_PHOTO('service-counter') },
  'display-shelf': { kind: 'display-shelf', label: 'Display shelf', category: 'fixtures', footprint: 'rect', width: 100, depth: 40, height: 190, slots: [frame('warm-oak')], photo: BUILT_IN_PHOTO('display-shelf') },
  'planter': { kind: 'planter', label: 'Planter', category: 'fixtures', footprint: 'rect', width: 100, depth: 40, height: 60, slots: [{ key: 'box', label: 'Box', options: WOODS, default: 'warm-oak' }], photo: BUILT_IN_PHOTO('planter') },
  'plant': { kind: 'plant', label: 'Plant', category: 'fixtures', footprint: 'round', width: 50, depth: 50, height: 120, slots: [{ key: 'pot', label: 'Pot', options: ['terracotta', ...STONES], default: 'terracotta' }], photo: BUILT_IN_PHOTO('plant') },
  'room-divider': { kind: 'room-divider', label: 'Room divider', category: 'fixtures', footprint: 'rect', width: 120, depth: 20, height: 180, slots: [frame('warm-oak')], photo: BUILT_IN_PHOTO('room-divider') },
  'stairs': { kind: 'stairs', label: 'Stairs', category: 'structure', footprint: 'rect', width: 100, depth: 340, height: 300, slots: [{ key: 'tread', label: 'Treads', options: WOODS, default: 'warm-oak' }], photo: null },
}

export const TABLE_SLOTS: Record<'top' | 'base', FinishSlot> = {
  top: { key: 'top', label: 'Tabletop', options: [...WOODS, ...STONES], default: 'warm-oak' },
  base: { key: 'base', label: 'Base', options: [...METALS, ...WOODS], default: 'graphite' },
}

/** The built-in table looks (step 3a adds a cafe's own), each with its picture (step 3d). */
export const BUILT_IN_LOOKS: TableLook[] = [
  { id: 'round-cafe', name: 'Round café table', shape: 'round', base: 'pedestal', chair: 'cafe-chair', finishes: { top: 'warm-oak', base: 'graphite', frame: 'warm-oak', seat: 'olive' }, defaultWidth: 80, defaultDepth: 80, photo: { url: BUILT_IN_PHOTO('round-cafe') } },
  { id: 'square-bistro', name: 'Square bistro table', shape: 'rect', base: 'pedestal', chair: 'bentwood-chair', finishes: { top: 'walnut', base: 'graphite', frame: 'walnut' }, defaultWidth: 70, defaultDepth: 70, photo: { url: BUILT_IN_PHOTO('square-bistro') } },
  { id: 'oak-rectangle', name: 'Oak rectangle', shape: 'rect', base: 'legs', chair: 'cafe-chair', finishes: { top: 'warm-oak', base: 'warm-oak', frame: 'warm-oak', seat: 'olive' }, defaultWidth: 120, defaultDepth: 80, photo: { url: BUILT_IN_PHOTO('oak-rectangle') } },
  { id: 'communal', name: 'Communal table', shape: 'rect', base: 'legs', chair: 'cafe-chair', finishes: { top: 'pale-oak', base: 'pale-oak', frame: 'pale-oak', seat: 'linen' }, defaultWidth: 240, defaultDepth: 90, photo: { url: BUILT_IN_PHOTO('communal') } },
  { id: 'green-booth', name: 'Green velvet booth', shape: 'booth', base: 'legs', chair: 'none', finishes: { top: 'walnut', base: 'walnut', frame: 'walnut', seat: 'olive' }, defaultWidth: 140, defaultDepth: 75, photo: { url: BUILT_IN_PHOTO('green-booth') } },
]

/** The look a table starts with when it's placed from Unplaced tables. */
export const NEW_TABLE_LOOK = 'round-cafe'

export function findLook(looks: readonly TableLook[], id: string): TableLook {
  return looks.find(look => look.id === id) ?? BUILT_IN_LOOKS[0]!
}

/** A slot's finish on an item, or the kind's default. */
export function itemFinish(kind: ItemKind, finishes: Partial<Record<string, Finish>>, key: string): Finish {
  const slot = ITEM_SPECS[kind].slots.find(candidate => candidate.key === key)
  return finishes[key] ?? slot?.default ?? 'warm-oak'
}

/** A look's finish for a slot; chair slots fall back to the chair kind's defaults. */
export function lookFinish(look: TableLook, key: string): Finish {
  if (look.finishes[key]) return look.finishes[key]!
  if (key === 'top' || key === 'base') return TABLE_SLOTS[key].default
  return look.chair === 'none' ? 'olive' : itemFinish(look.chair, {}, key)
}

/** The cafe's look named by a piece, if it still has it (deleted elsewhere: `undefined`). */
export function findItemLook(looks: readonly ItemLook[], id: string | undefined): ItemLook | undefined {
  return id === undefined ? undefined : looks.find(look => look.id === id)
}

/**
 * What a piece is finished with (step 3d): its look's finishes when it uses one of the cafe's
 * looks of its kind, otherwise its own. A look deleted elsewhere falls back to the piece's own.
 */
export function pieceFinishes(item: Pick<LayoutItem, 'kind' | 'finishes' | 'lookId'>, looks: readonly ItemLook[]): LayoutItem['finishes'] {
  const look = findItemLook(looks, item.lookId)
  return look && look.kind === item.kind ? look.finishes : item.finishes
}
