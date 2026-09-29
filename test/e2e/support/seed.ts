import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { organization } from '../../../server/db/tables'
import { createTable, updateBranchSettings } from '../../../server/features/branches'
import type { Actor } from '../../../server/features/identity'
import { loadSampleMenuStep } from '../../../server/features/sample-data'
import { applyMigration, createAdmin, migrationFiles } from '../../../server/tests/support/db'
import type { Db } from '../../../server/utils/batch'

/**
 * The e2e server's own database (D95): the customer site renders on the server, so its tests need
 * real data, not browser mocks. Rebuilt from the checked-in migrations before every run and filled
 * through the real services, with the Standard sample menu (D94), so tests read the same catalog an
 * admin loads: one branch always open, one with no hours (closed), and a table in each.
 * The admin tests don't use it (the admin renders in the browser, against `mockApi`).
 */

export interface ShopSeed {
  /** Always open ("Riverside"): the first branch by name, the one the menu shows by default. */
  openBranchId: string
  /** No opening hours ("Zeta Kiosk"): closed. */
  closedBranchId: string
  /** QR tokens of table T01 at Riverside and K01 at Zeta Kiosk. */
  openTableToken: string
  closedTableToken: string
}

async function addBranch(db: Db, name: string) {
  const id = crypto.randomUUID()
  await db.insert(organization).values({ id, name, slug: name.toLowerCase().replaceAll(' ', '-'), timezone: 'Asia/Phnom_Penh', status: 'active', createdAt: new Date() })
  return id
}

const tokenOf = (qrUrl: string | null) => qrUrl!.split('/').pop()!

export async function seedShop(dbFile: string, qrSecret: string): Promise<ShopSeed> {
  for (const file of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    if (existsSync(file)) rmSync(file)
  }
  mkdirSync(dirname(dbFile), { recursive: true })
  const client = createClient({ url: `file:${dbFile}` })
  await client.execute('PRAGMA foreign_keys = ON')
  for (const file of migrationFiles()) await applyMigration(client, file)
  const db: Db = drizzle({ client, casing: 'snake_case' })

  const admin = await createAdmin(db, 'e2e-admin@example.com')
  const actor: Actor = { userId: admin.userId, role: 'admin' }
  const openBranchId = await addBranch(db, 'Riverside')
  const closedBranchId = await addBranch(db, 'Zeta Kiosk')

  // Open around the clock, so tests don't depend on the time they run at.
  const allDay = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, startMinute: 0, endMinute: 1440 }))
  await updateBranchSettings(db, actor, openBranchId, { version: 1, hours: allDay })

  for (let steps = 0; ; steps++) {
    const state = await loadSampleMenuStep(db, actor, { size: 'standard' }, 'E2E')
    if (state.menu.run?.finished) break
    if (steps > 100) throw new Error('The sample menu never finished loading')
  }

  const qr = { secret: qrSecret, baseUrl: 'http://e2e.local' }
  const openTable = await createTable(db, actor, openBranchId, { label: 'T01', area: 'Main floor' }, qr)
  const closedTable = await createTable(db, actor, closedBranchId, { label: 'K01', area: null }, qr)
  client.close()
  return { openBranchId, closedBranchId, openTableToken: tokenOf(openTable.qrUrl), closedTableToken: tokenOf(closedTable.qrUrl) }
}
