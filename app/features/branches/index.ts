// Public API of the branches feature: building blocks other features may use.
// Never export pages or forms from here. Route files import those directly.
export { useBranchOptions } from './composables/useBranchOptions'
export { branchesNavigation } from './navigation'
export { branchesSetup } from './setup'

// Explore (D275) builds its world from the designer's pieces. The plan geometry is pure and small;
// the three.js builders load on demand (`loadSceneKit`), so three.js never joins the bundles that
// import this file. Type exports are erased.
export { summarizeFrames } from './designer/benchmark'
export type { FrameSummary } from './designer/benchmark'
export { BUILT_IN_LOOKS, findLook, ITEM_SPECS, pieceHeight } from './designer/catalog'
export { chairPoses, DOOR_HEIGHT_CM, innerWallHeight, outwardNormal, placementExtent, RAILING_HEIGHT_CM, rectCorners, SLAB_THICKNESS_CM } from './designer/geometry'
export { planLane, toPlan } from './designer/surroundings'
export type { SurroundingsPlan } from './designer/surroundings'
export type { BuiltScene } from './designer/scene/scene'
export type { Stage, StageDetails, StageStats } from './designer/scene/stage'
export type { BuiltSurroundings } from './designer/scene/surroundings'
export type { BuildContext } from './designer/scene/furniture'
export type { MaterialLibrary } from './designer/scene/materials'

export function loadSceneKit() {
  return import('./designer/scene/kit')
}
export type SceneKit = Awaited<ReturnType<typeof loadSceneKit>>
