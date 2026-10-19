import { describe, expect, it } from 'vitest'
import { cropFrame, cropOutputSize, isNearRatio, MAX_ZOOM, moveCrop, newCrop, placePhoto, zoomCrop } from '../../app/utils/image-crop'

const wide = { width: 2000, height: 1000 }
const square = cropFrame(1)

describe('image crop', () => {
  it('fills the frame when centred and not zoomed, with no gap at any edge', () => {
    const placed = placePhoto(wide, square, newCrop())
    expect(placed.height).toBeCloseTo(1)
    expect(placed.width).toBeCloseTo(2)
    expect(placed.x).toBeCloseTo(-0.5)
    expect(placed.y).toBeCloseTo(0)
  })

  it('moves the photo with the pointer, and stops at the edge instead of leaving a gap', () => {
    const right = moveCrop(wide, square, newCrop(), 0.25, 0)
    expect(placePhoto(wide, square, right).x).toBeCloseTo(-0.25)
    const far = moveCrop(wide, square, newCrop(), 5, 0)
    expect(placePhoto(wide, square, far).x).toBeCloseTo(0)
    // Moves past the edge don't pile up: coming back moves the photo at once.
    const back = moveCrop(wide, square, far, -0.1, 0)
    expect(placePhoto(wide, square, back).x).toBeCloseTo(-0.1)
  })

  it('cannot move along the side the photo exactly fills', () => {
    expect(moveCrop(wide, square, newCrop(), 0, 0.4).y).toBeCloseTo(0.5)
  })

  it('zooms between filling the frame and the maximum, keeping the middle', () => {
    expect(zoomCrop(wide, square, newCrop(), 0.2).zoom).toBe(1)
    expect(zoomCrop(wide, square, newCrop(), 99).zoom).toBe(MAX_ZOOM)
    const zoomed = zoomCrop(wide, square, newCrop(), 2)
    expect(zoomed.x).toBeCloseTo(0.5)
    expect(placePhoto(wide, square, zoomed).height).toBeCloseTo(2)
  })

  it('works for tall frames too', () => {
    const portrait = cropFrame(4 / 5)
    const placed = placePhoto(wide, portrait, newCrop())
    expect(placed.height).toBeCloseTo(1)
    expect(placed.width).toBeCloseTo(2)
    expect(placed.x).toBeLessThanOrEqual(0)
    expect(placed.x + placed.width).toBeGreaterThanOrEqual(portrait.width)
  })

  it('makes the file in the frame\'s proportions at the photo\'s own pixels, never enlarged', () => {
    expect(cropOutputSize(wide, square, newCrop(), 1600)).toEqual({ width: 1000, height: 1000 })
    expect(cropOutputSize(wide, square, zoomCrop(wide, square, newCrop(), 2), 1600)).toEqual({ width: 500, height: 500 })
  })

  it('knows a photo that is already the frame\'s shape, give or take 2 %', () => {
    expect(isNearRatio({ width: 1080, height: 1350 }, 4 / 5)).toBe(true)
    expect(isNearRatio({ width: 1070, height: 1350 }, 4 / 5)).toBe(true)
    expect(isNearRatio({ width: 1080, height: 1080 }, 4 / 5)).toBe(false)
    expect(isNearRatio({ width: 1920, height: 1080 }, 4 / 5)).toBe(false)
  })

  it('caps the longest side at the maximum', () => {
    const big = { width: 4000, height: 3000 }
    expect(cropOutputSize(big, square, newCrop(), 1600)).toEqual({ width: 1600, height: 1600 })
    expect(cropOutputSize(big, cropFrame(4 / 3), newCrop(), 1600)).toEqual({ width: 1600, height: 1200 })
  })
})
