/**
 * The cafe's branches as Explore connects them (D275, docs/plans/explore.md → Districts and
 * gateways, step E4). Pure: real distances from the branches' public pins, the chain of districts
 * the gateways join, the next district toward a destination, and the nearby list. The customer's
 * position is used here, in the browser, and never sent anywhere (decision 6).
 */

export interface Pin {
  latitude: number
  longitude: number
}

/** A branch published in Explore: its pin is saved. */
export interface NetworkBranch extends Pin {
  id: string
  name: string
}

const EARTH_RADIUS_KM = 6371

/** The great-circle distance between two pins (haversine), in kilometres. */
export function distanceKm(a: Pin, b: Pin): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = radians(b.latitude - a.latitude)
  const dLon = radians(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Up to this many branches, the shortest chain is found exactly (8! orders); beyond, greedily. */
const EXACT_LIMIT = 8

function chainLength(order: readonly NetworkBranch[]): number {
  let total = 0
  for (let index = 1; index < order.length; index++) total += distanceKm(order[index - 1]!, order[index]!)
  return total
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]))
}

/** Starting from `first`, always the nearest branch not yet in the chain. */
function greedyFrom(first: NetworkBranch, rest: readonly NetworkBranch[]): NetworkBranch[] {
  const order = [first]
  const left = [...rest]
  while (left.length) {
    const last = order.at(-1)!
    let best = 0
    for (let index = 1; index < left.length; index++) {
      if (distanceKm(last, left[index]!) < distanceKm(last, left[best]!)) best = index
    }
    order.push(left.splice(best, 1)[0]!)
  }
  return order
}

/**
 * The districts in the order their gateways join them: the shortest open chain through every
 * branch's pin. A street has two ends, so a district has at most two neighbours (the one before
 * it at the lane's start, the one after it at the lane's end). The same branches give the same
 * chain whatever order they come in, and its direction is fixed (the smaller end id first).
 */
export function branchChain<T extends NetworkBranch>(branches: readonly T[]): T[] {
  const sorted = [...branches].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  if (sorted.length <= 2) return sorted
  let best: T[] = sorted
  let bestLength = Infinity
  const candidates = sorted.length <= EXACT_LIMIT ? permutations(sorted) : sorted.map((first, index) => greedyFrom(first, sorted.filter((_, other) => other !== index)) as T[])
  for (const order of candidates) {
    // A chain and its reverse are the same chain: keep the one that starts with the smaller id.
    if (order[0]!.id > order.at(-1)!.id) continue
    const total = chainLength(order)
    if (total < bestLength - 1e-9) {
      best = order
      bestLength = total
    }
  }
  return best
}

export type GatewaySide = 'start' | 'end'

export interface Neighbour {
  side: GatewaySide
  branch: NetworkBranch
}

/** A district's gateways: the branch before it at the lane's start, the one after it at its end. */
export function neighboursOf(chain: readonly NetworkBranch[], id: string): Neighbour[] {
  const index = chain.findIndex(branch => branch.id === id)
  if (index < 0) return []
  const result: Neighbour[] = []
  if (index > 0) result.push({ side: 'start', branch: chain[index - 1]! })
  if (index < chain.length - 1) result.push({ side: 'end', branch: chain[index + 1]! })
  return result
}

/**
 * The gateway to take from `from` toward `to`: the side the destination lies on along the chain.
 * Null when either isn't in the chain or they are the same branch.
 */
export function sideToward(chain: readonly NetworkBranch[], from: string, to: string): GatewaySide | null {
  const a = chain.findIndex(branch => branch.id === from)
  const b = chain.findIndex(branch => branch.id === to)
  if (a < 0 || b < 0 || a === b) return null
  return b < a ? 'start' : 'end'
}

/** How many gateways a walk from `from` to `to` crosses. */
export function hopsBetween(chain: readonly NetworkBranch[], from: string, to: string): number {
  const a = chain.findIndex(branch => branch.id === from)
  const b = chain.findIndex(branch => branch.id === to)
  return a < 0 || b < 0 ? 0 : Math.abs(a - b)
}

/** Branches within this many kilometres are "nearby". */
export const NEARBY_KM = 5

export interface NearbyEntry<T> {
  branch: T
  /** Null without the customer's position. */
  km: number | null
}

export interface NearbyList<T> {
  /** With a position: within `NEARBY_KM`, nearest first. Without one: every branch by name. */
  near: NearbyEntry<T>[]
  /** With a position: the rest, nearest first. Without one: empty. */
  farther: NearbyEntry<T>[]
}

/** The nearby list (docs/plans/explore.md → Location): nothing is hidden, one cafe has few branches. */
export function nearbyList<T extends NetworkBranch>(branches: readonly T[], position: Pin | null): NearbyList<T> {
  if (!position) {
    const byName = [...branches].sort((left, right) => left.name.localeCompare(right.name))
    return { near: byName.map(branch => ({ branch, km: null })), farther: [] }
  }
  const entries = branches
    .map(branch => ({ branch, km: distanceKm(position, branch) }))
    .sort((left, right) => left.km - right.km || left.branch.name.localeCompare(right.branch.name))
  return { near: entries.filter(entry => entry.km <= NEARBY_KM), farther: entries.filter(entry => entry.km > NEARBY_KM) }
}

/** "850 m", "1.8 km", "24 km": real distance, always labelled apart from Explore's ride time. */
export function formatKm(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round(km * 100) * 10)} m`
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}
