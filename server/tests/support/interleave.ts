import type { Db } from '../../utils/batch'

/**
 * The database, but its next `batch` first runs `meanwhile` (another request's write): the change
 * lands between the service's checks and its write, which only the in-batch guards can catch.
 */
export function interleaved(db: Db, meanwhile: () => Promise<unknown>): Db {
  let pending = true
  return new Proxy(db, {
    get(target, key, receiver) {
      if (key === 'batch' && pending) {
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
