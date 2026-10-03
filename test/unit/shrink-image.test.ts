import { describe, expect, it } from 'vitest'
import { fitWithin, IMAGE_MAX_EDGE, pickSmaller } from '../../app/utils/shrink-image'

describe('making photos smaller before upload (D122)', () => {
  it('fits the longest side within 1600 px, keeping the proportions', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 })
    expect(fitWithin(5000, 1000)).toEqual({ width: IMAGE_MAX_EDGE, height: 320 })
  })

  it('never enlarges a small image', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 })
  })

  it('keeps the original when the result isn\'t smaller, or there is none', () => {
    const original = new File([new Uint8Array(1000)], 'latte.jpg', { type: 'image/jpeg' })
    expect(pickSmaller(original, null)).toBe(original)
    expect(pickSmaller(original, new Blob([new Uint8Array(1200)], { type: 'image/webp' }))).toBe(original)
  })

  it('names the smaller file after the original, with the extension of its type', () => {
    const original = new File([new Uint8Array(5000)], 'IMG_2041.HEIC.jpg', { type: 'image/jpeg' })
    const webp = pickSmaller(original, new Blob([new Uint8Array(300)], { type: 'image/webp' }))
    expect([webp.name, webp.type, webp.size]).toEqual(['IMG_2041.HEIC.webp', 'image/webp', 300])
    const jpeg = pickSmaller(original, new Blob([new Uint8Array(300)], { type: 'image/jpeg' }))
    expect(jpeg.name).toBe('IMG_2041.HEIC.jpg')
  })
})
