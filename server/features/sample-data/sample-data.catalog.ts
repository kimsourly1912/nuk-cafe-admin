import type { SampleMenuSize } from '#shared/contracts/sample-data'
import { SAMPLE_MENU_ITEMS } from '#shared/contracts/sample-data'

/**
 * The sample menu (D94): a Phnom Penh cafe in English and USD. Pure data plus the rules that expand
 * it per size; the service turns it into records through the menu's own services. Records are found
 * again by name, so loading can stop and continue without duplicates: names are unique here.
 */

export type CategoryKey = 'coffee' | 'espresso' | 'signature' | 'tea' | 'classicTea' | 'milkTea' | 'frappe' | 'bakery'
export type SetKey = 'size' | 'temperature' | 'sweetness'
export type GroupKey = 'milk' | 'syrups' | 'extras' | 'toppings'
export type RuleKey = 'breakfast' | 'lateNight'

/** Top-level categories first, each before its sub-categories. */
export const SAMPLE_CATEGORIES: { key: CategoryKey, name: string, description: string, parent?: CategoryKey }[] = [
  { key: 'coffee', name: 'Coffee', description: 'Espresso drinks and our house specials.' },
  { key: 'espresso', name: 'Espresso Bar', description: 'Classics pulled from our house blend.', parent: 'coffee' },
  { key: 'signature', name: 'Signature Coffee', description: 'Local favourites and cold brews.', parent: 'coffee' },
  { key: 'tea', name: 'Tea', description: 'Brewed to order, hot or over ice.' },
  { key: 'classicTea', name: 'Classic Tea', description: '', parent: 'tea' },
  { key: 'milkTea', name: 'Milk Tea', description: 'With pearls, jelly or cheese foam.', parent: 'tea' },
  { key: 'frappe', name: 'Frappé', description: 'Blended with ice.' },
  { key: 'bakery', name: 'Bakery', description: 'Baked every morning.' },
]

export const SAMPLE_OPTION_SETS: { key: SetKey, name: string, values: string[] }[] = [
  { key: 'size', name: 'Size', values: ['Regular', 'Large'] },
  { key: 'temperature', name: 'Temperature', values: ['Hot', 'Iced'] },
  { key: 'sweetness', name: 'Sweetness', values: ['0%', '50%', '100%'] },
]

export const SAMPLE_MODIFIER_GROUPS: { key: GroupKey, name: string, minSelect: number, maxSelect: number | null, modifiers: { name: string, priceDeltaMinor: number }[] }[] = [
  { key: 'milk', name: 'Milk', minSelect: 1, maxSelect: 1, modifiers: [
    { name: 'Whole milk', priceDeltaMinor: 0 },
    { name: 'Oat milk', priceDeltaMinor: 50 },
    { name: 'Almond milk', priceDeltaMinor: 50 },
    { name: 'Soy milk', priceDeltaMinor: 30 },
  ] },
  { key: 'syrups', name: 'Syrups', minSelect: 0, maxSelect: 2, modifiers: [
    { name: 'Vanilla', priceDeltaMinor: 30 },
    { name: 'Caramel', priceDeltaMinor: 30 },
    { name: 'Hazelnut', priceDeltaMinor: 30 },
    { name: 'Coconut', priceDeltaMinor: 30 },
  ] },
  { key: 'extras', name: 'Extras', minSelect: 0, maxSelect: 3, modifiers: [
    { name: 'Extra shot', priceDeltaMinor: 50 },
    { name: 'Whipped cream', priceDeltaMinor: 30 },
    { name: 'Less ice', priceDeltaMinor: 0 },
  ] },
  { key: 'toppings', name: 'Toppings', minSelect: 0, maxSelect: 2, modifiers: [
    { name: 'Boba pearls', priceDeltaMinor: 40 },
    { name: 'Grass jelly', priceDeltaMinor: 40 },
    { name: 'Cheese foam', priceDeltaMinor: 60 },
  ] },
]

const DAILY = [1, 2, 3, 4, 5, 6, 7]
export const SAMPLE_RULES: { key: RuleKey, name: string, windows: { weekday: number, startMinute: number, endMinute: number }[] }[] = [
  { key: 'breakfast', name: 'Breakfast', windows: DAILY.map(weekday => ({ weekday, startMinute: 420, endMinute: 660 })) },
  // Friday and Saturday, 9:00 PM to 1:00 AM (overnight).
  { key: 'lateNight', name: 'Late night', windows: [5, 6].map(weekday => ({ weekday, startMinute: 1260, endMinute: 60 })) },
]

/** The option sets an item's grid uses, and how its prices step from the base. */
export type Grid = 'none' | 'size' | 'sizeTemperature' | 'sizeSweetness'

export interface SampleItem {
  name: string
  description: string
  category: CategoryKey
  /** The first version's price, in cents. */
  priceMinor: number
  grid: Grid
  groups: GroupKey[]
  rules: RuleKey[]
  /** Where it ends: published (active), a draft, archived, or published and sold out everywhere. */
  state: 'active' | 'draft' | 'archived' | 'soldOut'
  /** In the Small menu too. */
  small: boolean
}

type Row = [name: string, description: string, category: CategoryKey, price: number, grid: Grid, groups: GroupKey[], extra?: { rules?: RuleKey[], state?: SampleItem['state'], small?: boolean }]

// 40 items. Small: 12 of them (one each of draft, archived and sold out, so every size shows every
// state). Standard: 35 published (2 sold out), 3 drafts, 2 archived.
const ROWS: Row[] = [
  ['Espresso', 'A double shot of our house blend.', 'espresso', 150, 'none', ['extras']],
  ['Americano', 'Espresso topped with hot water.', 'espresso', 200, 'sizeTemperature', ['extras']],
  ['Latte', 'Espresso with steamed milk and light foam.', 'espresso', 250, 'sizeTemperature', ['milk', 'syrups', 'extras'], { small: true }],
  ['Cappuccino', 'Equal parts espresso, milk and foam.', 'espresso', 250, 'sizeTemperature', ['milk', 'extras']],
  ['Flat White', 'Ristretto with velvety milk.', 'espresso', 275, 'none', ['milk']],
  ['Macchiato', 'Espresso marked with a little foam.', 'espresso', 225, 'none', ['milk']],
  ['Mocha', 'Espresso, chocolate and steamed milk.', 'espresso', 300, 'sizeTemperature', ['milk', 'extras']],
  ['Cortado', 'Espresso cut with warm milk.', 'espresso', 225, 'none', ['milk'], { state: 'draft', small: true }],
  ['Long Black', 'Hot water topped with a double shot.', 'espresso', 200, 'sizeTemperature', [], { state: 'archived', small: true }],
  ['Affogato', 'Vanilla ice cream drowned in espresso.', 'espresso', 325, 'none', [], { rules: ['lateNight'] }],
  ['Khmer Iced Coffee', 'Strong coffee with sweetened condensed milk, over ice.', 'signature', 175, 'size', ['extras'], { small: true }],
  ['Coconut Coffee', 'Coffee blended with coconut cream.', 'signature', 275, 'size', ['extras']],
  ['Salted Caramel Latte', 'Latte with house caramel and sea salt.', 'signature', 325, 'sizeTemperature', ['milk', 'extras'], { small: true }],
  ['Honey Cinnamon Latte', 'Latte with local honey and cinnamon.', 'signature', 300, 'sizeTemperature', ['milk']],
  ['Cold Brew', 'Steeped for 18 hours, smooth and bold.', 'signature', 275, 'size', ['extras'], { small: true }],
  ['Orange Espresso Tonic', 'Espresso over tonic and fresh orange.', 'signature', 325, 'none', []],
  ['Egg Coffee', 'Coffee under a whipped egg-yolk cream.', 'signature', 350, 'none', [], { state: 'draft' }],
  ['Cheese Foam Cold Brew', 'Cold brew under salty cheese foam.', 'signature', 350, 'size', ['toppings'], { state: 'soldOut' }],
  ['Jasmine Green Tea', 'Fragrant green tea with jasmine blossoms.', 'classicTea', 175, 'sizeTemperature', [], { small: true }],
  ['Earl Grey', 'Black tea with bergamot.', 'classicTea', 175, 'sizeTemperature', []],
  ['Lemongrass Ginger Tea', 'Fresh lemongrass and ginger, lightly sweet.', 'classicTea', 200, 'sizeTemperature', []],
  ['Iced Lemon Tea', 'Black tea shaken with fresh lemon.', 'classicTea', 200, 'size', ['extras']],
  ['Peach Iced Tea', 'Black tea with peach, over ice.', 'classicTea', 225, 'size', ['extras']],
  ['Chamomile', 'Caffeine-free chamomile flowers.', 'classicTea', 200, 'none', [], { state: 'archived' }],
  ['Hibiscus Iced Tea', 'Tart hibiscus with a touch of honey.', 'classicTea', 225, 'size', [], { state: 'draft' }],
  ['Classic Milk Tea', 'Black tea with milk, sweetened to your taste.', 'milkTea', 225, 'sizeSweetness', ['toppings'], { small: true }],
  ['Thai Tea', 'Spiced Thai tea with milk.', 'milkTea', 225, 'sizeSweetness', ['toppings']],
  ['Matcha Latte', 'Stone-ground matcha with milk.', 'milkTea', 325, 'sizeTemperature', ['milk'], { small: true }],
  ['Brown Sugar Boba Milk', 'Fresh milk with brown-sugar pearls.', 'milkTea', 300, 'sizeSweetness', ['toppings']],
  ['Taro Milk Tea', 'Creamy taro with black tea.', 'milkTea', 275, 'sizeSweetness', ['toppings']],
  ['Hojicha Latte', 'Roasted green tea with milk.', 'milkTea', 300, 'sizeTemperature', ['milk'], { state: 'soldOut', small: true }],
  ['Mocha Frappé', 'Coffee, chocolate and milk blended with ice.', 'frappe', 350, 'size', ['extras'], { small: true }],
  ['Caramel Frappé', 'Coffee and caramel blended with ice.', 'frappe', 350, 'size', ['extras']],
  ['Matcha Frappé', 'Matcha and milk blended with ice.', 'frappe', 375, 'size', ['extras']],
  ['Cookies & Cream Frappé', 'Chocolate cookies blended with milk and ice.', 'frappe', 375, 'size', ['extras']],
  ['Butter Croissant', 'Flaky, all-butter croissant.', 'bakery', 175, 'none', [], { rules: ['breakfast'], small: true }],
  ['Chocolate Croissant', 'Croissant with dark chocolate.', 'bakery', 200, 'none', [], { rules: ['breakfast'] }],
  ['Ham & Cheese Croissant', 'Warm croissant with ham and cheddar.', 'bakery', 300, 'none', [], { rules: ['breakfast'] }],
  ['Banana Bread', 'Moist banana bread with walnuts.', 'bakery', 225, 'none', []],
  ['Blueberry Muffin', 'Bursting with blueberries.', 'bakery', 200, 'none', []],
]

const BASE_ITEMS: SampleItem[] = ROWS.map(([name, description, category, priceMinor, grid, groups, extra]) => ({
  name,
  description,
  category,
  priceMinor,
  grid,
  groups,
  rules: extra?.rules ?? [],
  state: extra?.state ?? 'active',
  small: extra?.small ?? false,
}))

// Large adds flavoured variants of everyday drinks and bakes, all published: 11 flavours × 10 bases.
const FLAVOURS = ['Vanilla', 'Hazelnut', 'Coconut', 'Honey', 'Cinnamon', 'Maple', 'Lavender', 'Rose', 'Pandan', 'Almond', 'Brown Sugar']
const VARIANT_BASES: (Pick<SampleItem, 'category' | 'priceMinor' | 'grid' | 'groups'> & { label: string })[] = [
  { label: 'Latte', category: 'espresso', priceMinor: 275, grid: 'sizeTemperature', groups: ['milk', 'extras'] },
  { label: 'Cappuccino', category: 'espresso', priceMinor: 275, grid: 'sizeTemperature', groups: ['milk'] },
  { label: 'Mocha', category: 'espresso', priceMinor: 325, grid: 'sizeTemperature', groups: ['milk'] },
  { label: 'Cold Brew', category: 'signature', priceMinor: 300, grid: 'size', groups: ['extras'] },
  { label: 'Iced Coffee', category: 'signature', priceMinor: 200, grid: 'size', groups: [] },
  { label: 'Milk Tea', category: 'milkTea', priceMinor: 250, grid: 'sizeSweetness', groups: ['toppings'] },
  { label: 'Matcha', category: 'milkTea', priceMinor: 350, grid: 'sizeTemperature', groups: ['milk'] },
  { label: 'Frappé', category: 'frappe', priceMinor: 375, grid: 'size', groups: ['extras'] },
  { label: 'Muffin', category: 'bakery', priceMinor: 225, grid: 'none', groups: [] },
  { label: 'Scone', category: 'bakery', priceMinor: 225, grid: 'none', groups: [] },
]

const VARIANTS: SampleItem[] = FLAVOURS.flatMap(flavour => VARIANT_BASES.map(base => ({
  name: `${flavour} ${base.label}`,
  description: `Our ${base.label.toLowerCase()} with a touch of ${flavour.toLowerCase()}.`,
  category: base.category,
  priceMinor: base.priceMinor,
  grid: base.grid,
  groups: base.groups,
  rules: [],
  state: 'active' as const,
  small: false,
})))

/** The items of a size, in menu order (their order within each category). */
export function itemsForSize(size: SampleMenuSize): SampleItem[] {
  if (size === 'small') return BASE_ITEMS.filter(item => item.small)
  if (size === 'standard') return BASE_ITEMS
  return [...BASE_ITEMS, ...VARIANTS].slice(0, SAMPLE_MENU_ITEMS.large)
}

/** The option sets a grid uses, in grid order. */
export const GRID_SETS: Record<Grid, SetKey[]> = {
  none: [],
  size: ['size'],
  sizeTemperature: ['size', 'temperature'],
  sizeSweetness: ['size', 'sweetness'],
}

/**
 * The price of one version, from the values it combines (in grid order): Large adds $0.50, Iced
 * $0.25; sweetness doesn't change the price.
 */
export function versionPrice(base: number, valueNames: string[]): number {
  return base + (valueNames.includes('Large') ? 50 : 0) + (valueNames.includes('Iced') ? 25 : 0)
}

/** Every combination of the sets' values, in grid order (one empty combination without sets). */
export function combinations<T>(sets: T[][]): T[][] {
  return sets.reduce<T[][]>((rows, values) => rows.flatMap(row => values.map(value => [...row, value])), [[]])
}

/** Sample hours: Monday–Friday 7:00 AM–9:00 PM, Saturday–Sunday 8:00 AM–10:00 PM. */
export const SAMPLE_HOURS = [
  ...[1, 2, 3, 4, 5].map(weekday => ({ weekday, startMinute: 420, endMinute: 1260 })),
  ...[6, 7].map(weekday => ({ weekday, startMinute: 480, endMinute: 1320 })),
]

/** Sample tables: T01–T08 on the main floor, P01–P04 on the patio. */
export const SAMPLE_TABLES = [
  ...Array.from({ length: 8 }, (_, i) => ({ label: `T${String(i + 1).padStart(2, '0')}`, area: 'Main floor' })),
  ...Array.from({ length: 4 }, (_, i) => ({ label: `P${String(i + 1).padStart(2, '0')}`, area: 'Patio' })),
]
