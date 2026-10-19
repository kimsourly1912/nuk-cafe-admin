import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import { itemCountsQuerySchema, itemListQuerySchema } from '#shared/contracts/menu-items'
import { staffListQuerySchema } from '#shared/contracts/staff'
import { tenantListQuerySchema } from '#shared/contracts/tenants'

// The three searches take up to 100 characters, trimmed. The server matches them with `instr`, so
// that length reaches the database whole (a D1 `like` pattern could not hold it, D183).
describe.each([
  ['items', itemListQuerySchema],
  ['item counts', itemCountsQuerySchema],
  ['staff', staffListQuerySchema],
  ['cafes', tenantListQuerySchema],
])('%s search', (_, schema) => {
  const parse = (search: string) => v.safeParse(schema, { search })

  it('takes 100 characters, Khmer or not, and trims around them', () => {
    expect(parse('a'.repeat(100)).success).toBe(true)
    expect(parse('ក'.repeat(100)).success).toBe(true)
    expect(parse(`  ${'ក'.repeat(17)}  `)).toMatchObject({ success: true, output: { search: 'ក'.repeat(17) } })
  })

  it('refuses 101', () => {
    expect(parse('a'.repeat(101)).success).toBe(false)
    expect(parse('ក'.repeat(101)).success).toBe(false)
  })
})
