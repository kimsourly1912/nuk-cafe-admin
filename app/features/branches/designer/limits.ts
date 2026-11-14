import type { Floor, ShopLayout } from '#shared/contracts/shop-layout'
import { LAYOUT_MAX_FLOOR_BYTES, LAYOUT_MAX_ITEMS_PER_FLOOR, LAYOUT_MAX_WALLS_PER_FLOOR } from '#shared/contracts/shop-layout'

/**
 * The contract's per-floor limits (D273 step 2a), checked in the editor before a change is made
 * (ISS-043): a change that takes a floor over one is refused with why, instead of being made and
 * then stopping autosave. Only growth is refused, so a floor that is somehow over a limit can still
 * be edited back under it.
 */

export const FLOOR_FULL_ITEMS = `A floor holds at most ${LAYOUT_MAX_ITEMS_PER_FLOOR} pieces of furniture.`
export const FLOOR_FULL_WALLS = `A floor holds at most ${LAYOUT_MAX_WALLS_PER_FLOOR} inside walls.`
export const FLOOR_FULL_BYTES = 'This floor holds too much: move some furniture to another floor.'

/** Why `after` may not replace `before`: a floor grew past a limit. `null` when it may. */
export function floorLimitProblem(before: Pick<ShopLayout, 'floors'>, after: Pick<ShopLayout, 'floors'>): string | null {
  const previous = new Map(before.floors.map(floor => [floor.id, floor]))
  for (const floor of after.floors) {
    const old = previous.get(floor.id)
    if (grew(floor.items.length, old?.items.length, LAYOUT_MAX_ITEMS_PER_FLOOR)) return FLOOR_FULL_ITEMS
    if (grew(floor.walls.length, old?.walls.length, LAYOUT_MAX_WALLS_PER_FLOOR)) return FLOOR_FULL_WALLS
  }
  // Bytes last: the counts above are cheaper and say more.
  for (const floor of after.floors) {
    const old = previous.get(floor.id)
    if (old === floor) continue
    if (grew(floorBytes(floor), old && floorBytes(old), LAYOUT_MAX_FLOOR_BYTES)) return FLOOR_FULL_BYTES
  }
  return null
}

/** A floor's size as the contract measures it (its JSON in UTF-8). */
export function floorBytes(floor: Floor): number {
  return new TextEncoder().encode(JSON.stringify(floor)).length
}

function grew(now: number, then: number | undefined, max: number): boolean {
  return now > max && now > (then ?? 0)
}
