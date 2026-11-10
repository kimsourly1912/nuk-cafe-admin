import type { Db } from '#server/utils/batch'

/**
 * The database, but its next `batch` first runs `meanwhile` (another request's write): the change
 * lands between the service's checks and its write, which only the in-batch guards can catch.
 * `skip` passes that many batches first, for a service whose checks read with a batch.
 */
export function interleaved(db: Db, meanwhile: () => Promise<unknown>, skip = 0): Db {
  let pending = true
  let skipped = 0
  return new Proxy(db, {
    get(target, key, receiver) {
      if (key === 'batch' && pending && skipped++ >= skip) {
        return async (statements: unknown) => {
          pending = false
          await meanwhile()
          return target.batch(statements as never)
        }
      }
      return Reflect.get(target, key, receiver)
    },
  })
}

/**
 * Commit a real write after the first matching read. Independent reads wait until that write;
 * a batch keeps its entire result from before it. This makes mixed-state responses reproducible.
 */
export function interleavedRead(db: Db, matches: (sql: string) => boolean, meanwhile: () => Promise<unknown>): Db {
  let pending = true
  let gate = Promise.resolve()
  const after = async <T>(read: PromiseLike<T>, sql: string): Promise<T> => {
    if (pending && matches(sql)) {
      pending = false
      const result = await read
      await meanwhile()
      return result
    }
    return read
  }
  const wrap = (query: object): unknown => new Proxy(query, {
    get(target, key) {
      if (key === 'then') return (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        const read = target as { toSQL: () => { sql: string }, then: PromiseLike<unknown>['then'] }
        const run = gate.then(() => after(read, read.toSQL().sql))
        gate = run.then(() => undefined)
        return run.then(resolve, reject)
      }
      const value = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const result = value.apply(target, args)
        return result && typeof result.toSQL === 'function' && typeof result.then === 'function' ? wrap(result) : result
      }
    },
  })
  return new Proxy(db, {
    get(target, key, receiver) {
      if (key === 'select') return (...args: unknown[]) => wrap(target.select(...args as Parameters<Db['select']>))
      if (key === 'batch') return async (statements: Parameters<Db['batch']>[0]) => {
        const sql = statements.map(statement => (statement as unknown as { toSQL: () => { sql: string } }).toSQL().sql).find(matches) ?? ''
        return after(target.batch(statements), sql)
      }
      return Reflect.get(target, key, receiver)
    },
  })
}
