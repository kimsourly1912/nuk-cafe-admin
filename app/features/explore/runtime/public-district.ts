import type { ItemLook, LayoutTable, PublicExploreLayout, ShopLayout, TableLook } from '#shared/contracts/shop-layout'
import { BUILT_IN_LOOKS } from '~/features/branches'
import type { DistrictInput } from './district'

/**
 * A published branch's drawing (step E3's public projection) as Explore builds it (step E4). The
 * projection has no dining records: each placement carries its seat count instead, so the builders
 * get a stand-in table per placement (`placed-<n>`), never a real table id or label. The scene is
 * always the Neighborhood lane: it is the only preset with a street to walk (D274).
 */
export function publicDistrictInput(branch: { id: string, name: string }, published: PublicExploreLayout): DistrictInput {
  const tables: LayoutTable[] = published.placements.map((placement, index) => ({ id: `placed-${index}`, label: '', seats: placement.seats }))
  const layout: ShopLayout = {
    floors: published.floors,
    placements: published.placements.map(({ seats: _seats, ...placement }, index) => ({ ...placement, tableId: `placed-${index}` })),
    scene: { preset: 'neighborhood-lane', entrance: published.scene.entrance, explore: true },
  }
  const looks: TableLook[] = [...BUILT_IN_LOOKS, ...published.looks.map(look => ({ ...look, name: '' }))]
  const itemLooks: ItemLook[] = published.itemLooks.map(look => ({ ...look, name: '' }))
  return { name: branch.name, layout, tables, looks, itemLooks, seed: branch.id }
}
