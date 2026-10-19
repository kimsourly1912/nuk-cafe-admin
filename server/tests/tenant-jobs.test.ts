import { describe, expect, it, vi } from 'vitest'
import { runJob, runTenantPage } from '#server/utils/jobs'
import { createTestDb, ensureTenant } from '#server/tests/support/db'
import { organization } from '#server/db/tables'
import { eq } from 'drizzle-orm'
import { isJobCurrent, jobProgress, jobRunRows, saveJobCursor } from '#server/features/platform'

describe('a scheduled job\'s run (System health, D192)', () => {
  it('is recorded when it succeeds and when it fails; the failure is still thrown, and a lost record never fails the job', async () => {
    const db = await createTestDb()
    vi.stubGlobal('useDb', () => db)
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await runJob('test:job', async () => 'done')).toBe('done')
      expect(await jobRunRows(db)).toMatchObject([{ job: 'test:job', failuresInARow: 0 }])
      await expect(runJob('test:job', async () => {
        throw new Error('broken')
      })).rejects.toThrow('broken')
      expect(await jobRunRows(db)).toMatchObject([{ job: 'test:job', failuresInARow: 1 }])
      // The database is gone: the job's own result still comes back.
      vi.stubGlobal('useDb', () => {
        throw new Error('no database')
      })
      const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(await runJob('test:job', async () => 'still done')).toBe('still done')
      warnings.mockRestore()
    }
    finally {
      logs.mockRestore()
      vi.unstubAllGlobals()
    }
  })
})

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

  it('does not report all-failed generation as a successful heartbeat, but still advances', async () => {
    const db = await createTestDb()
    for (const id of ['a', 'b', 'c']) await ensureTenant(db, id)
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await runTenantPage(db, 'notifications:generate', async () => {
        throw new Error('Unavailable')
      }, 2)
      expect(await jobProgress(db, 'notifications:generate')).toMatchObject({ processed: 2, failures: 2, succeededAt: null })
      expect(await isJobCurrent(db, 'notifications:generate', 300)).toBe(false)
      const seen: string[] = []
      await runTenantPage(db, 'notifications:generate', async (tenant) => {
        seen.push(tenant.id)
      }, 2)
      expect(seen).toEqual(['c'])
      expect(await isJobCurrent(db, 'notifications:generate', 300)).toBe(true)
    }
    finally {
      logs.mockRestore()
    }
  })

  it('keeps the last success during transient total failures, which becomes stale during sustained failure', async () => {
    const db = await createTestDb()
    const now = new Date()
    await saveJobCursor(db, 'job', 'a', { now, processed: 2, failures: 1 })
    await saveJobCursor(db, 'job', 'b', { now: new Date(now.getTime() + 200_000), processed: 2, failures: 2 })
    expect(await jobProgress(db, 'job')).toMatchObject({ succeededAt: now, processed: 2, failures: 2 })
    expect(await isJobCurrent(db, 'job', 300, new Date(now.getTime() + 200_000))).toBe(true)
    expect(await isJobCurrent(db, 'job', 300, new Date(now.getTime() + 301_000))).toBe(false)
    await saveJobCursor(db, 'job', null)
    expect(await isJobCurrent(db, 'job', 300)).toBe(true)
    await saveJobCursor(db, 'job', null, { now: new Date(now.getTime() + 10) })
    expect(await isJobCurrent(db, 'job', 300, now)).toBe(true)
  })

  it('does not invent success on an empty cursor page after an exact-size all-failed page', async () => {
    const db = await createTestDb()
    for (const id of ['a', 'b']) await ensureTenant(db, id)
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (let i = 0; i < 2; i++) {
        expect(await runTenantPage(db, 'notifications:generate', async () => {
          throw new Error('Every cafe unavailable')
        }, 2)).toEqual({ processed: 2, failures: ['a', 'b'] })
        expect(await isJobCurrent(db, 'notifications:generate', 300)).toBe(false)
      }
    }
    finally {
      logs.mockRestore()
    }
  })
})
