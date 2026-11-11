import { existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FIGURE_KINDS } from '#shared/contracts/shop-layout'
import { FIGURE_MODELS, MODEL_MAX_BYTES } from '../designer/models'

// The model files the designer ships (step 3g, D274): each one listed with its source, creator and
// CC0 license, and nothing in the folder that the list doesn't name.

const folder = fileURLToPath(new URL('../../../../public/shop-designer/models/', import.meta.url))
const assets = Object.entries(FIGURE_MODELS)

describe('the model list', () => {
  it('names every file in the folder, and every file it names is there and within budget', () => {
    const files = existsSync(folder) ? readdirSync(folder).sort() : []
    expect(files).toEqual([...new Set(assets.map(([, asset]) => asset.file))].sort())
    for (const [, asset] of assets) expect(statSync(`${folder}${asset.file}`).size, asset.file).toBeLessThanOrEqual(MODEL_MAX_BYTES)
  })

  it('records a CC0 source, creator and date for every model', () => {
    for (const [kind, asset] of assets) {
      expect(FIGURE_KINDS, kind).toContain(kind)
      expect(asset.license, kind).toBe('CC0-1.0')
      expect(asset.source, kind).toMatch(/^https:\/\/\S+$/)
      expect(asset.creator.trim(), kind).not.toBe('')
      expect(asset.title.trim(), kind).not.toBe('')
      expect(asset.retrieved, kind).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(asset.file, kind).toMatch(/^[a-z0-9-]+\.glb$/)
    }
  })
})
