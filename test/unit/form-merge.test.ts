import { describe, expect, it } from 'vitest'
import { mergeFormChanges } from '~/utils/form-value'

interface Form { name: string, price?: number, imageId?: string, imageUrl?: string, tags: string[] }
const base: Form = { name: 'Latte', price: 3, imageId: 'img-1', imageUrl: '/a.webp', tags: ['hot'] }
const parts = [{ label: 'Image', keys: ['imageId', 'imageUrl'] as const }]

describe('mergeFormChanges', () => {
  it('takes their parts and keeps mine where I changed something', () => {
    const mine = { ...base, name: 'Caffè Latte' }
    const theirs = { ...base, price: 4, tags: ['hot', 'iced'] }
    const { merged, overlap } = mergeFormChanges({ base, mine, theirs, parts })
    expect(merged).toEqual({ ...base, name: 'Caffè Latte', price: 4, tags: ['hot', 'iced'] })
    expect(overlap).toEqual([])
  })

  it('names a part both changed differently, keeping mine', () => {
    const mine = { ...base, price: 5 }
    const theirs = { ...base, price: 4 }
    expect(mergeFormChanges({ base, mine, theirs, parts })).toEqual({ merged: mine, overlap: ['price'] })
  })

  it('says nothing when both made the same change', () => {
    const mine = { ...base, price: 4 }
    expect(mergeFormChanges({ base, mine, theirs: { ...mine }, parts }).overlap).toEqual([])
  })

  it('moves a part as one: their new image keeps its own preview', () => {
    const theirs = { ...base, imageId: 'img-2', imageUrl: '/b.webp' }
    expect(mergeFormChanges({ base, mine: { ...base }, theirs, parts }).merged).toMatchObject({ imageId: 'img-2', imageUrl: '/b.webp' })
    const mine = { ...base, imageId: 'img-3', imageUrl: '/c.webp' }
    const both = mergeFormChanges({ base, mine, theirs, parts })
    expect(both.merged).toMatchObject({ imageId: 'img-3', imageUrl: '/c.webp' })
    expect(both.overlap).toEqual(['Image'])
  })

  it('keeps a value I cleared', () => {
    const mine = { ...base, imageId: undefined, imageUrl: undefined }
    const theirs = { ...base, name: 'Flat white' }
    expect(mergeFormChanges({ base, mine, theirs, parts }).merged).toMatchObject({ name: 'Flat white', imageId: undefined, imageUrl: undefined })
  })

  it('copies, never shares, the values it returns', () => {
    const mine = { ...base, tags: ['iced'] }
    const { merged } = mergeFormChanges({ base, mine, theirs: base, parts })
    merged.tags.push('x')
    expect(mine.tags).toEqual(['iced'])
  })
})
