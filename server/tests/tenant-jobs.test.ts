import { describe, expect, it, vi } from 'vitest'
import { runTenantPage } from '#server/utils/jobs'
import { createTestDb, ensureTenant } from '#server/tests/support/db'
import { organization } from '#server/db/tables'
import { eq } from 'drizzle-orm'
import { isJobCurrent, saveJobCursor } from '#server/features/platform'

describe('bounded tenant jobs', () => {
  it('reports missing and stale scheduler heartbeats as unavailable', async () => {
    const db = await createTestDb()
    expect(await isJobCurrent(db, 'notifications:generate', 300)).toBe(false)
    await saveJobCursor(db, 'notifications:generate', null)
    expect(await isJobCurrent(db, 'notifications:generate', 300)).toBe(true)
    expect(await isJobCurrent(db, 'notifications:generate', 300, new Date(Date.now() + 301_000))).toBe(false)
  })
  it('continues past a failed cafe, resumes the next page and wraps for a retry', async () => {
    const db = await createTestDb()
    for (const id of ['a', 'b', 'c', 'd']) await ensureTenant(db, id)
    await db.update(organization).set({ status: 'suspended' }).where(eq(organization.id, 'b'))
    const seen: string[] = []
    const work = async (tenant: { id: string }) => {
      seen.push(tenant.id)
      if (tenant.id === 'a') throw new Error('Cafe A unavailable')
    }
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await runTenantPage(db, 'notifications:test', work, 2)).toEqual({ processed: 2, failures: ['a'] })
      expect(seen).toEqual(['a', 'c'])
      expect(await runTenantPage(db, 'notifications:test', work, 2)).toEqual({ processed: 1, failures: [] })
      expect(seen).toEqual(['a', 'c', 'd'])
      await runTenantPage(db, 'notifications:test', work, 2)
      expect(seen).toEqual(['a', 'c', 'd', 'a', 'c'])
      // Another job has its own progress.
      const separate: string[] = []
      await runTenantPage(db, 'another:job', async (tenant) => {
        separate.push(tenant.id)
      }, 1)
      expect(separate).toEqual(['a'])
    }
    finally {
      logs.mockRestore()
    }
  })
})
