import type { H3Event } from 'h3'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { parseInput, readIdParam } from '#server/utils/validation'
import { failure } from '#server/tests/support/failure'

const schema = v.strictObject({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Required')),
  variations: v.array(v.strictObject({ priceMinor: v.pipe(v.number(), v.minValue(0, 'Must be 0 or more')) })),
})

describe('parseInput', () => {
  it('returns the parsed output', () => {
    expect(parseInput(schema, { name: '  Latte ', variations: [{ priceMinor: 350 }] })).toEqual({ name: 'Latte', variations: [{ priceMinor: 350 }] })
  })

  it('throws 400 VALIDATION_FAILED with messages per field path, unknown keys included', async () => {
    const error = await failure(Promise.resolve().then(() => parseInput(schema, { name: '', variations: [{ priceMinor: -1 }], extra: true })))
    expect(error).toEqual({ status: 400, code: 'VALIDATION_FAILED' })
    try {
      parseInput(schema, { name: '', variations: [{ priceMinor: -1 }], extra: true })
    }
    catch (e) {
      const { fieldErrors } = (e as { data: { fieldErrors: Record<string, string[]> } }).data
      expect(fieldErrors.name).toEqual(['Required'])
      expect(fieldErrors['variations.0.priceMinor']).toEqual(['Must be 0 or more'])
      expect(Object.keys(fieldErrors)).toContain('extra')
    }
  })
})

describe('readIdParam', () => {
  const eventWith = (params: Record<string, string>) => ({ context: { params } }) as unknown as H3Event

  it('returns a valid UUID', () => {
    expect(readIdParam(eventWith({ itemId: '01a0e126-c781-77b2-a953-da057cd40481' }), 'itemId', 'The item')).toBe('01a0e126-c781-77b2-a953-da057cd40481')
  })

  it('answers 404 (not 400) for anything that is not an id', async () => {
    for (const value of ['1', 'abc', '../etc']) {
      expect(await failure(Promise.resolve().then(() => readIdParam(eventWith({ itemId: value }), 'itemId', 'The item')))).toEqual({ status: 404, code: 'NOT_FOUND' })
    }
  })
})
