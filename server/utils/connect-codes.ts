import { and, gt, inArray } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { SQLiteColumn, SQLiteTable, SQLiteUpdateSetSource } from 'drizzle-orm/sqlite-core'
import type { Db, Statement } from './batch'
import { byId } from './query'

type ConnectCodeTable = SQLiteTable & {
  tenantId: SQLiteColumn
  id: SQLiteColumn
  status: SQLiteColumn
  expiresAt: SQLiteColumn
}

/** A cafe's one-time connect code, still at an allowed stage and strictly before its expiry. */
export function liveConnectCode(table: ConnectCodeTable, tenantId: string, id: string, from: string[], now: Date): SQL {
  return and(byId(table, tenantId, id), inArray(table.status, from), gt(table.expiresAt, now))!
}

/** Ends only a code still waiting for Telegram or the admin. Expired waiting codes may also be cancelled. */
export function cancellableConnectCode(table: ConnectCodeTable, tenantId: string, id: string): SQL {
  return and(byId(table, tenantId, id), inArray(table.status, ['waiting', 'confirm']))!
}

/** Advances a single-use code in the service's batch. Follow it with `requireOneChange`. */
export function advanceConnectCodeStatement<T extends ConnectCodeTable>(db: Db, table: T, tenantId: string, id: string, from: string[], changes: SQLiteUpdateSetSource<T>, now: Date): Statement {
  return db.update(table).set(changes).where(liveConnectCode(table, tenantId, id, from, now))
}
