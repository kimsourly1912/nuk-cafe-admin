import type { H3Event } from 'h3'
import * as v from 'valibot'
import { idempotencyKeyRequired } from '../features/platform'

const keySchema = v.pipe(v.string(), v.uuid())

/**
 * The `Idempotency-Key` header of an action that must never apply twice (architecture.md →
 * Idempotency): a UUID the client generates once per user action and resends on every retry.
 * Missing or malformed: 400. Pass it to the feature, which runs the action through
 * `withIdempotency`.
 */
export function readIdempotencyKey(event: H3Event): string {
  const result = v.safeParse(keySchema, getHeader(event, 'idempotency-key'))
  if (!result.success) throw idempotencyKeyRequired()
  return result.output.toLowerCase()
}
