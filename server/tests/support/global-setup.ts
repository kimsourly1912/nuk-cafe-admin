import type { TestProject } from 'vitest/node'
import { buildMigratedSchema } from './db'

/** Runs the migrations once for the whole server project; every `createTestDb()` replays the result (D174). */
export default async function ({ provide }: TestProject) {
  provide('migratedSchema', await buildMigratedSchema())
}
