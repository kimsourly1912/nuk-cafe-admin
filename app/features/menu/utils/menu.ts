import type { PublicMenu, PublicMenuItem } from '#shared/contracts/public-menu'

/**
 * How the customer menu reads (D93): main categories as sections (the flat tabs scroll to them),
 * their sub-categories as sub-sections (the "All categories" tree scrolls to those). A main
 * category holds sub-categories or items, never both (D44), so a section has one or the other.
 */

export interface MenuSubSection {
  id: string
  name: string
  description: string
  items: PublicMenuItem[]
}

export interface MenuSection extends MenuSubSection {
  subSections: MenuSubSection[]
  /** Items in the section and its sub-sections. */
  count: number
}

export function menuSections(menu: PublicMenu | null | undefined): MenuSection[] {
  return (menu?.categories ?? []).map((category) => {
    const subSections = category.categories.map(sub => ({ id: sub.id, name: sub.name, description: sub.description, items: sub.items }))
    return {
      id: category.id,
      name: category.name,
      description: category.description,
      items: category.items,
      subSections,
      count: category.items.length + subSections.reduce((sum, sub) => sum + sub.items.length, 0),
    }
  })
}

/** Every item on the menu, in menu order. */
export const menuItems = (sections: MenuSection[]) =>
  sections.flatMap(section => [...section.items, ...section.subSections.flatMap(sub => sub.items)])

/**
 * An item with anything to choose opens its detail to add: more than one version, or any add-on
 * group (optional ones too, so they can be picked). Everything else is added in one tap.
 */
export const hasChoices = (item: PublicMenuItem) => item.variations.length > 1 || item.modifierGroups.length > 0

/** The lowest price among what can be ordered (every version when all are sold out), and whether others cost more. */
export function priceOf(item: PublicMenuItem): { minor: number, from: boolean } {
  const orderable = item.variations.filter(v => !v.soldOut)
  const prices = (orderable.length ? orderable : item.variations).map(v => v.priceMinor)
  const minor = Math.min(...prices)
  return { minor, from: prices.some(price => price !== minor) }
}

// --- Search ---

/** Case- and accent-insensitive text for matching ("Café" matches "cafe"). */
const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export interface SearchGroup {
  /** "Coffee" or "Coffee → Hot". */
  path: string
  items: PublicMenuItem[]
}

/** Items whose name or description contains the query, grouped by where they are on the menu. */
export function searchMenu(sections: MenuSection[], query: string): SearchGroup[] {
  const needle = fold(query.trim())
  if (!needle) return []
  const matches = (item: PublicMenuItem) => fold(item.name).includes(needle) || fold(item.description).includes(needle)
  const groups: SearchGroup[] = []
  for (const section of sections) {
    const own = section.items.filter(matches)
    if (own.length) groups.push({ path: section.name, items: own })
    for (const sub of section.subSections) {
      const found = sub.items.filter(matches)
      if (found.length) groups.push({ path: `${section.name} → ${sub.name}`, items: found })
    }
  }
  return groups
}

/** The text split around each match of the query, for highlighting (accent-insensitive). */
export function highlightParts(text: string, query: string): { text: string, match: boolean }[] {
  const needle = fold(query.trim())
  if (!needle) return [{ text, match: false }]
  // Folding keeps one character per character for the Latin letters a menu uses; if it doesn't
  // (a letter that folds to two), skip highlighting rather than mark the wrong letters.
  const folded = fold(text)
  if (folded.length !== text.length) return [{ text, match: false }]
  const parts: { text: string, match: boolean }[] = []
  let from = 0
  for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + needle.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false })
    parts.push({ text: text.slice(at, at + needle.length), match: true })
    from = at + needle.length
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false })
  return parts
}
