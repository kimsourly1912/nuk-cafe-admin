import { expect } from 'vitest'

/** The API error `promise` rejects with, as `{ status, code }`; fails the test if it resolves. */
export async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: { statusCode?: number, data?: { code?: string } }) => e,
  )
  expect(error, 'expected the call to fail').toBeDefined()
  return { status: error!.statusCode, code: error!.data?.code }
}

/** Asserts that `call` (sync or async) fails with this API error status and code. */
export async function expectApiError(call: () => unknown, status: number, code: string) {
  const promise = (async () => call())()
  expect(await failure(promise)).toEqual({ status, code })
}
