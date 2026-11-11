import type { FigureKind } from '#shared/contracts/shop-layout'

/**
 * The 3D model files the designer ships (step 3g, D274): every one is CC0, and this list is the
 * record of where it came from. `models.test.ts` fails when a file in
 * `public/shop-designer/models/` has no entry, an entry has no file, a license isn't CC0, or a
 * file is over its budget. Pure data: no three.js here.
 */

export interface ModelAsset {
  /** The file in `public/shop-designer/models/`. */
  file: string
  /** The model's name at its source. */
  title: string
  /** The page it was downloaded from, where its license is stated. */
  source: string
  creator: string
  license: 'CC0-1.0'
  /** When it was downloaded (YYYY-MM-DD). */
  retrieved: string
  /** What we changed: recolored, retextured, trimmed, animations kept. */
  changes: string
  /** Degrees to turn it about the vertical so it faces the plan's front (+y); glTF's front is +z. */
  turn?: number
  /** The looping animation it plays while standing (its name in the file); none: a still model. */
  idle?: string
}

/** Each figure's model. A kind without one draws only its contact shadow. */
export const FIGURE_MODELS: Partial<Record<FigureKind, ModelAsset>> = {}

/** At most, per file: a figure must not cost more than a page of photos. */
export const MODEL_MAX_BYTES = 400 * 1024

export const modelUrl = (asset: Pick<ModelAsset, 'file'>) => `/shop-designer/models/${asset.file}`
