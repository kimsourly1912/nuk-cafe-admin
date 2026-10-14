/** Keep cleanup statements/results bounded even when a caller supplies a larger limit. */
export function maintenanceLimit(limit = 500): number {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('A maintenance batch limit must be a positive integer')
  return Math.min(limit, 500)
}

/** Stop starting batches at the budget; an in-flight batch completes. The next run resumes. */
export async function drainMaintenance(work: (limit: number) => Promise<number>, options: { budgetMs?: number, batchSize?: number } = {}): Promise<number> {
  const limit = maintenanceLimit(options.batchSize)
  const started = Date.now()
  let removed = 0
  for (let batch = 0; batch < 50; batch++) {
    if (Date.now() - started >= (options.budgetMs ?? 5000)) break
    const count = await work(limit)
    removed += count
    if (count < limit) break
  }
  return removed
}
