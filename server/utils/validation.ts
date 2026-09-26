import type { H3Event } from 'h3'
import { getQuery, readBody } from 'h3'
import * as v from 'valibot'
import { apiError } from './api-error'

/** Largest JSON body a write accepts. */
const MAX_JSON_BYTES = 256 * 1024

/**
 * Validates input with a contract schema, or throws 400 VALIDATION_FAILED with the messages per
 * field path (`name`, `variantGroups.0.options.1.name`).
 */
export function parseInput<T extends v.GenericSchema>(schema: T, input: unknown): v.InferOutput<T> {
  const result = v.safeParse(schema, input)
  if (result.success) return result.output
  const fieldErrors: Record<string, string[]> = {}
  for (const issue of result.issues) {
    const path = v.getDotPath(issue) ?? ''
    ;(fieldErrors[path] ??= []).push(issue.message)
  }
  return failValidation(fieldErrors)
}

function failValidation(fieldErrors: Record<string, string[]>): never {
  throw apiError(400, 'VALIDATION_FAILED', 'Some of the submitted data is invalid.', fieldErrors)
}

export async function readBodyAs<T extends v.GenericSchema>(event: H3Event, schema: T): Promise<v.InferOutput<T>> {
  const length = Number(event.node.req.headers['content-length'] ?? 0)
  if (length > MAX_JSON_BYTES) throw apiError(413, 'VALIDATION_FAILED', 'The request is too large.')
  let body: unknown
  try {
    body = await readBody(event)
  }
  catch {
    throw apiError(400, 'VALIDATION_FAILED', 'The request body is not valid JSON.')
  }
  return parseInput(schema, body ?? {})
}

export function readQueryAs<T extends v.GenericSchema>(event: H3Event, schema: T): v.InferOutput<T> {
  return parseInput(schema, getQuery(event))
}

/** A route parameter that must be an id. */
export function idParam(value: string | undefined, what: string): string {
  const result = v.safeParse(v.pipe(v.string(), v.uuid()), value)
  if (!result.success) throw apiError(404, 'NOT_FOUND', `${what} was not found.`)
  return result.output
}
