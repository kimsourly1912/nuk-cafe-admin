import type { Client } from '@libsql/client'

/**
 * The test databases still open. libsql crashes the worker (exit code 3221225477, an access
 * violation) when the garbage collector frees a database it was never told to close, so none is
 * left to it (D176): one opened during a test or its `beforeEach` closes after that test, any other
 * (a `beforeAll`, the file's top level) after the file. `server/tests/support/setup.ts` calls
 * `startTest` / `endTest` / `endFile` around every test and file.
 */
const open = { test: new Set<Client>(), file: new Set<Client>() }
let inTest = false

/** Remembers a new client so it gets closed; returns it. */
export function trackClient(client: Client): Client {
  open[inTest ? 'test' : 'file'].add(client)
  return client
}

function closeAll(set: Set<Client>) {
  for (const client of set) client.close()
  set.clear()
}

export function startTest() {
  inTest = true
}

/** Closes the clients opened since `startTest`. */
export function endTest() {
  inTest = false
  closeAll(open.test)
}

/** Closes every client still open. */
export function endFile() {
  endTest()
  closeAll(open.file)
}
