import { expect } from 'vitest'

type ThrownApiError = { statusCode?: number, data?: { code?: string, fieldErrors?: Record<string, string[]> } }

async function rejection(promise: Promise<unknown>): Promise<ThrownApiError> {
  const error = await promise.then(() => undefined, (e: ThrownApiError) => e)
  expect(error, 'expected the call to fail').toBeDefined()
  return error!
}

/** The API error `promise` rejects with, as `{ status, code }`; fails the test if it resolves. */
export async function failure(promise: Promise<unknown>) {
  const error = await rejection(promise)
  return { status: error.statusCode, code: error.data?.code }
}

/**
 * Asserts that `call` (sync or async) fails with this API error status and code, and, with
 * `fields`, exactly these field errors.
 */
export async function expectApiError(call: () => unknown, status: number, code: string, fields?: string[]) {
  const promise = (async () => call())()
  const error = await rejection(promise)
  expect({ status: error.statusCode, code: error.data?.code }).toEqual({ status, code })
  if (fields) expect(Object.keys(error.data?.fieldErrors ?? {})).toEqual(fields)
}
