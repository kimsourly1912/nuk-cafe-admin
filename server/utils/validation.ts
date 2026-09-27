import type { H3Event } from 'h3'
import { getHeader, getQuery, getRouterParam, readBody } from 'h3'
import * as v from 'valibot'
import { apiError, ErrorCodes } from './errors'

/** Largest JSON body a write accepts (docs/server/security.md → Request protection). */
export const MAX_JSON_BYTES = 64 * 1024

/**
 * Validates input with a Valibot schema, or throws 400 VALIDATION_FAILED with the messages per
 * field path (`name`, `variations.0.priceMinor`).
 */
export function parseInput<T extends v.GenericSchema>(schema: T, input: unknown): v.InferOutput<T> {
  const result = v.safeParse(schema, input)
  if (result.success) return result.output
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of result.issues) {
    const path = v.getDotPath(issue) ?? ''
    ;(fieldErrors[path] ??= []).push(issue.message)
  }
  throw apiError(400, ErrorCodes.VALIDATION_FAILED, 'Some of the submitted data is invalid.', { fieldErrors })
}

/** The JSON body, size-limited and validated. */
export async function readValidBody<T extends v.GenericSchema>(event: H3Event, schema: T): Promise<v.InferOutput<T>> {
  if (Number(getHeader(event, 'content-length') ?? 0) > MAX_JSON_BYTES) {
    throw apiError(413, ErrorCodes.PAYLOAD_TOO_LARGE, 'The request is too large.')
  }
  let body: unknown
  try {
    body = await readBody(event)
  }
  catch {
    throw apiError(400, ErrorCodes.VALIDATION_FAILED, 'The request body is not valid JSON.')
  }
  return parseInput(schema, body ?? {})
}

/** The query string, validated (values arrive as strings: use coercing schemas). */
export function readValidQuery<T extends v.GenericSchema>(event: H3Event, schema: T): v.InferOutput<T> {
  return parseInput(schema, getQuery(event))
}

const uuidSchema = v.pipe(v.string(), v.uuid())

/**
 * A route parameter that must be an id (UUID). Anything else is 404, not 400: a malformed id
 * can't name an existing record, and we don't explain id formats to callers.
 */
export function readIdParam(event: H3Event, name: string, what: string): string {
  const result = v.safeParse(uuidSchema, getRouterParam(event, name))
  if (!result.success) throw apiError(404, ErrorCodes.NOT_FOUND, `${what} was not found.`)
  return result.output
}
