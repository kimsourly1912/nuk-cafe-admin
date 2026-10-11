import { describe, expect, it } from 'vitest'
import { edgeColor, frameOf, isSmallPhoto, minZoom, moveView, newEdit, placePhoto, resetView, suggestedView, withFocus, zoomView } from '../utils/photo'

// The photo editor's rules (D158): where a photo sits in each view, so the previews and the saved
// files agree.

const LANDSCAPE = { width: 2400, height: 1600 } // 3:2, a phone photo
const PORTRAIT = { width: 1500, height: 2000 } // 3:4, a tall glass
const NEAR = { width: 2000, height: 1600 } // 5:4, close to 4:3

describe('placing a photo in a frame', () => {
  it('zoom 1 fills the frame, centred on the view\'s point, never leaving a gap', () => {
    const square = frameOf('card')
    expect(placePhoto(LANDSCAPE, square, { zoom: 1, x: 0.5, y: 0.5 })).toEqual({ x: -0.25, y: 0, width: 1.5, height: 1 })
    // Asked for the far left edge: it stops where the photo's edge meets the frame's.
    expect(placePhoto(LANDSCAPE, square, { zoom: 1, x: 0, y: 0.5 }).x).toBe(0)
    expect(placePhoto(LANDSCAPE, square, { zoom: 1, x: 1, y: 0.5 }).x).toBe(-0.5)
  })

  it('zoomed out below the frame on a side, the photo is centred on that side', () => {
    const detail = frameOf('detail')
    const fitted = placePhoto(PORTRAIT, detail, { zoom: minZoom(PORTRAIT, 'detail'), x: 0.1, y: 0.9 })
    expect(fitted.height).toBeCloseTo(1)
    expect(fitted.x).toBeCloseTo((4 / 3 - fitted.width) / 2)
    expect(fitted.y).toBeCloseTo(0)
  })
})

describe('suggested views', () => {
  it('the menu card fills its square around the focus point', () => {
    expect(suggestedView(LANDSCAPE, 'card', { x: 0.4, y: 0.5 })).toEqual({ zoom: 1, x: expect.closeTo(0.4), y: 0.5, adjusted: false })
    // A focus near the edge settles where the photo still covers the square.
    expect(suggestedView(LANDSCAPE, 'card', { x: 0.05, y: 0.5 }).x).toBeCloseTo(1 / 3)
  })

  it('the item page shows the whole photo, unless filling 4:3 cuts very little of it', () => {
    const tall = suggestedView(PORTRAIT, 'detail', { x: 0.5, y: 0.5 })
    expect(tall.zoom).toBeCloseTo(minZoom(PORTRAIT, 'detail'))
    const placed = placePhoto(PORTRAIT, frameOf('detail'), tall)
    // The whole glass: top and bottom inside the frame.
    expect(placed.y).toBeCloseTo(0)
    expect(placed.y + placed.height).toBeCloseTo(1)
    // 5:4 is 94% of 4:3: it fills the frame.
    expect(suggestedView(NEAR, 'detail', { x: 0.5, y: 0.5 }).zoom).toBe(1)
  })

  it('moving the focus moves the views not adjusted, and Reset brings a view back', () => {
    let edit = newEdit(LANDSCAPE, '#ffffff')
    edit = { ...edit, detail: zoomView(LANDSCAPE, 'detail', edit.detail, 2) }
    edit = withFocus(LANDSCAPE, edit, { x: 0.4, y: 0.5 })
    expect(edit.card.x).toBeCloseTo(0.4)
    expect(edit.detail).toMatchObject({ zoom: 2, adjusted: true })
    expect(resetView(LANDSCAPE, edit, 'detail').detail.adjusted).toBe(false)
  })
})

describe('adjusting', () => {
  it('dragging moves the photo with the pointer, and stops at its edges', () => {
    const view = suggestedView(LANDSCAPE, 'card', { x: 0.5, y: 0.5 })
    // Dragged right by a tenth of the frame: the photo moves right, its middle further left.
    const moved = moveView(LANDSCAPE, 'card', view, 0.1, 0)
    expect(moved.x).toBeCloseTo(0.5 - 0.1 / 1.5)
    expect(moved.adjusted).toBe(true)
    // Dragged far: it stops at the edge, and dragging back moves it at once (nothing piled up).
    const far = moveView(LANDSCAPE, 'card', view, 5, 0)
    expect(placePhoto(LANDSCAPE, frameOf('card'), far).x).toBe(0)
    expect(moveView(LANDSCAPE, 'card', far, -0.1, 0).x).toBeGreaterThan(far.x)
  })

  it('zoom stays between the view\'s limits: the card never shows bars', () => {
    const card = suggestedView(LANDSCAPE, 'card', { x: 0.5, y: 0.5 })
    expect(zoomView(LANDSCAPE, 'card', card, 0.2).zoom).toBe(1)
    expect(zoomView(LANDSCAPE, 'card', card, 9).zoom).toBe(4)
    const detail = suggestedView(LANDSCAPE, 'detail', { x: 0.5, y: 0.5 })
    expect(zoomView(LANDSCAPE, 'detail', detail, 0.1).zoom).toBeCloseTo(minZoom(LANDSCAPE, 'detail'))
  })
})

describe('the fill colour and small photos', () => {
  it('averages the edge pixels only', () => {
    // 3 × 3: eight white edge pixels around one black middle one.
    const pixels = new Uint8ClampedArray(Array.from({ length: 9 }, (_, i) => (i === 4 ? [0, 0, 0, 255] : [255, 255, 255, 255])).flat())
    expect(edgeColor(pixels, 3, 3)).toBe('#ffffff')
  })

  it('warns about a photo whose short side is under 900 px', () => {
    expect(isSmallPhoto({ width: 1200, height: 800 })).toBe(true)
    expect(isSmallPhoto(LANDSCAPE)).toBe(false)
  })
})
