import { describe, expect, it } from 'vitest'
import { handleLayout } from '../designer/handles'

describe('selection handles (ED-01 to ED-03)', () => {
  it('a piece big on screen: corners centred on its corners, four sides, turn areas past the corners', () => {
    // 100 x 60 cm at 1 cm per pixel.
    const layout = handleLayout(100, 60, 1)
    expect(layout.marks).toHaveLength(4)
    expect(layout.resize.map(target => target.handle)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(layout.resize[0]).toEqual({ handle: 0, x: -58, y: -38, width: 16, height: 16 })
    // The top side runs between the corner targets, 8 px thick across the edge.
    expect(layout.resize[4]).toEqual({ handle: 4, x: -42, y: -34, width: 84, height: 8 })
    // The turn area starts where the corner's target ends (8 px out), so just outside turns.
    expect(layout.rotate[0]).toEqual({ x: -78, y: -58, size: 20 })
    expect(layout.rotate[2]).toEqual({ x: 58, y: 38, size: 20 })
  })

  it('keeps the same size on screen at any zoom', () => {
    const near = handleLayout(200, 120, 1)
    const far = handleLayout(200, 120, 2)
    expect(far.resize[0]!.width).toBe(near.resize[0]!.width * 2)
    expect(far.markSize).toBe(near.markSize * 2)
  })

  it('a small piece keeps its middle for moving: corner targets outside it, no sides (ED-03)', () => {
    // 100 cm at 3 cm per pixel: 33 px on screen.
    const layout = handleLayout(100, 100, 3)
    expect(layout.marks).toHaveLength(4)
    expect(layout.resize.map(target => target.handle)).toEqual([0, 1, 2, 3])
    expect(layout.resize[0]).toEqual({ handle: 0, x: -86, y: -86, width: 36, height: 36 })
    expect(layout.resize[2]).toEqual({ handle: 2, x: 50, y: 50, width: 36, height: 36 })
    for (const target of layout.resize) expect(target.x >= 50 || target.x + target.width <= -50).toBe(true)
  })

  it('a tiny piece, or one that does not resize, only moves and turns', () => {
    expect(handleLayout(100, 100, 20)).toMatchObject({ marks: [], resize: [] })
    expect(handleLayout(100, 100, 20).rotate).toHaveLength(4)
    expect(handleLayout(100, 100, 1, false)).toMatchObject({ marks: [], resize: [] })
  })
})
