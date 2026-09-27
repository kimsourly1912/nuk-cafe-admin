import { db } from 'hub:db'
import type { Db } from './batch'

/** The NuxtHub database (local SQLite, D1 on Cloudflare), typed for the services. */
export function useDb(): Db {
  return db as unknown as Db
}
