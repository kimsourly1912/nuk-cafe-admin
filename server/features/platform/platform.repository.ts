import { asc, eq, lt } from 'drizzle-orm'
import type { Db, Statement } from '#server/utils/batch'
import { deleteOldest } from '#server/utils/batch'
import { firstRow, inTenant } from '#server/utils/query'
import { newId } from '#server/utils/ids'
import { idempotencyKeys } from './platform.schema'
import type { IdempotencyScope } from './platform.types'

// --- Row types ---

export interface StoredIdempotencyKey {
  requestHash: string
  response: unknown
}

// --- Columns and conditions ---

const keyColumns = { requestHash: idempotencyKeys.requestHash, response: idempotencyKeys.response }

// --- Reads ---

/** The stored key, expired or not: a key counts until the expiry task removes it. */
export async function findIdempotencyKey(db: Db, scope: IdempotencyScope): Promise<StoredIdempotencyKey | undefined> {
  return firstRow(db
    .select(keyColumns)
    .from(idempotencyKeys)
    .where(inTenant(
      idempotencyKeys,
      scope.tenantId,
      eq(idempotencyKeys.actorId, scope.actorId),
      eq(idempotencyKeys.operation, scope.operation),
      eq(idempotencyKeys.key, scope.key),
    )))
}

// --- Write statements ---

export function insertIdempotencyKeyStatement(db: Db, scope: IdempotencyScope, requestHash: string, response: unknown, expiresAt: Date): Statement {
  return db.insert(idempotencyKeys).values({ id: newId(), ...scope, requestHash, response, expiresAt })
}

// --- Background-task writes ---

/** Across cafes: bounded expiry of idempotency records; uses idempotency_keys_expires_at_idx. */
export async function deleteIdempotencyKeysBefore(db: Db, now: Date, limit = 500): Promise<number> {
  return deleteOldest(db, idempotencyKeys, idempotencyKeys.id, lt(idempotencyKeys.expiresAt, now), [asc(idempotencyKeys.expiresAt), asc(idempotencyKeys.id)], limit)
}
