import type { PublicBranchListEntry } from '#shared/contracts/branches'
import type { NetworkBranch } from '../runtime/network'

/** A branch in Explore (step E4): published, so its pin is saved. */
export type ExploreBranch = PublicBranchListEntry & NetworkBranch

/**
 * The cafe's branches that are in Explore (D275, docs/plans/explore.md → Data and API): the public
 * branch list, kept between visits like the menu's (D173). A branch is in Explore with a saved pin
 * and a published layout (`hasExplore`, step E3); the drawing itself is read when its district loads.
 */
export function useExploreBranches() {
  const query = useApiQuery('explore:branches', () => apiFetch<PublicBranchListEntry[]>('/public/branches'), { staleTime: REFERENCE_STALE_TIME })
  const branches = computed<ExploreBranch[]>(() => (query.data.value ?? []).filter((branch): branch is ExploreBranch => branch.hasExplore && branch.latitude !== null && branch.longitude !== null))
  return { ...query, branches }
}
