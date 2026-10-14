import { afterEach, describe, expect, it, vi } from 'vitest'
import { drainMaintenance, maintenanceLimit } from '#server/utils/maintenance'

afterEach(() => vi.restoreAllMocks())

describe('bounded maintenance loops', () => {
  it('resumes full batches and stops once the backlog is drained', async () => {
    const work = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(2).mockResolvedValueOnce(1)
    expect(await drainMaintenance(work, { batchSize: 2 })).toBe(5)
    expect(work).toHaveBeenCalledTimes(3)
    expect(work).toHaveBeenCalledWith(2)
  })

  it('stops starting work after its budget and respects a zero budget', async () => {
    let clock = 0
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const work = vi.fn(async () => {
      clock += 3000
      return 500
    })
    expect(await drainMaintenance(work, { budgetMs: 5000 })).toBe(1000)
    expect(work).toHaveBeenCalledTimes(2)
    work.mockClear()
    expect(await drainMaintenance(work, { budgetMs: 0 })).toBe(0)
    expect(work).not.toHaveBeenCalled()
  })

  it('caps page size and batch count even with a static clock', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0)
    const work = vi.fn(async (limit: number) => limit)
    expect(await drainMaintenance(work, { batchSize: 100_000 })).toBe(25_000)
    expect(work).toHaveBeenCalledTimes(50)
    expect(work).toHaveBeenCalledWith(500)
    for (const invalid of [0, -1, NaN, Infinity, 1.5]) expect(() => maintenanceLimit(invalid)).toThrow(RangeError)
  })
})
