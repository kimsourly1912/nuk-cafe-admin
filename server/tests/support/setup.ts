import { afterAll, afterEach, beforeEach } from 'vitest'
import { endFile, endTest, startTest } from './clients'

// Every test database is closed, never left to the garbage collector (D176). These root hooks run
// before a file's own `beforeEach` and after its `afterEach` (Vitest's default `stack` order).
beforeEach(startTest)
afterEach(endTest)
afterAll(endFile)
