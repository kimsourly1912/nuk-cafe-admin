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
