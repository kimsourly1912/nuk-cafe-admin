import { sql } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { createTestDb } from '#server/tests/support/db'
import type { Db, Statement } from '#server/utils/batch'
import { itemCountsBySet } from '#server/features/menu/items.repository'
import { deleteGroupStatements, deleteModifierStatement, listGroups, modifiersOf } from '#server/features/menu/modifiers.repository'
import { deleteSetStatements, listSets } from '#server/features/menu/options.repository'

interface Built { query: string, params: unknown[] }

const built = (statement: Statement): Built => {
  const { sql: query, params } = (statement as unknown as { toSQL: () => { sql: string, params: unknown[] } }).toSQL()
  return { query, params }
}

/** SQLite's plan for a query, its parameters inlined. A delete's plan includes its foreign-key checks. */
async function planOf(db: Db, { query, params }: Built): Promise<string> {
  const pieces = query.split('?')
  let statement = sql.raw(pieces[0]!)
  for (let i = 0; i < params.length; i++) statement = sql`${statement}${params[i]}${sql.raw(pieces[i + 1]!)}`
  return JSON.stringify(await db.all(sql`explain query plan ${statement}`))
}

/** A migration-backed database that records the queries run outside a batch. */
async function recordingDb() {
  const queries: Built[] = []
  const db = await createTestDb({ logger: { logQuery: (query, params) => queries.push({ query, params }) } })
  return { db, queries }
}

// The usage tables' primary keys start with the item, so finding where a set or an add-on is used
// needs an index of its own: without one, each "in use" check, and each delete's foreign-key check,
// reads every cafe's rows.

it('finds an option set\'s items through menu_item_option_sets_set_idx', async () => {
  const { db, queries } = await recordingDb()
  await listSets(db, 'a', 'all')
  await itemCountsBySet(db, 'a', ['set-1'])
  const [guard, , deleteSet] = deleteSetStatements(db, 'a', 'set-1', 1)
  const checked = [...queries, built(guard!), built(deleteSet!)].filter(q => q.query.includes('menu_item_option_sets') || q.query.startsWith('delete from "menu_option_sets"'))
  expect(checked).toHaveLength(4)
  for (const query of checked) {
    const plan = await planOf(db, query)
    expect(plan).toContain('menu_item_option_sets_set_idx')
    expect(plan).not.toContain('SCAN menu_item_option_sets')
  }
})

it('finds an add-on\'s item prices through menu_item_modifier_prices_modifier_idx', async () => {
  const { db, queries } = await recordingDb()
  await listGroups(db, 'a', 'all')
  await modifiersOf(db, 'a', ['group-1'])
  const [guard, deleteModifiers] = deleteGroupStatements(db, 'a', 'group-1', 1)
  const checked = [...queries, built(deleteModifierStatement(db, 'a', 'group-1', 'modifier-1')), built(guard!), built(deleteModifiers!)]
  expect(checked).toHaveLength(5)
  for (const query of checked) {
    const plan = await planOf(db, query)
    expect(plan).toContain('menu_item_modifier_prices_modifier_idx')
    expect(plan).not.toContain('SCAN menu_item_modifier_prices')
  }
})
