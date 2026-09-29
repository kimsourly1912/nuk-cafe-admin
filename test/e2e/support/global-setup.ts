import { execSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    e2eHost: string
  }
}

const rootDir = fileURLToPath(new URL('../../..', import.meta.url))

/** Everything the production build reads. Tests aren't in it: editing a test never needs a rebuild. */
const BUILD_INPUTS = ['app', 'server', 'shared', 'public', 'nuxt.config.ts', '.nuxtrc', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', '.env']
/** Written next to the build; any other `nuxt build` (staging, dev) cleans `.output` and removes it. */
const FINGERPRINT_FILE = join(rootDir, '.output', '.e2e-build-fingerprint')

/**
 * Builds the app once and serves it for every e2e file (`setup({ host: inject('e2eHost') })`),
 * instead of `@nuxt/test-utils` building once per file. Runs only when the e2e project runs.
 *
 * Locally the build is reused when nothing it reads has changed (D83): the fingerprint covers every
 * build input's path and content plus the `NUXT_*` and `NODE_ENV` variables. CI (`CI` set) always
 * builds; `E2E_REBUILD=1` forces a build.
 */
export default async function ({ provide }: TestProject) {
  const fingerprint = buildFingerprint()
  const reuse = !process.env.CI
    && !process.env.E2E_REBUILD
    && existsSync(join(rootDir, '.output', 'server', 'index.mjs'))
    && existsSync(FINGERPRINT_FILE)
    && readFileSync(FINGERPRINT_FILE, 'utf8') === fingerprint
  if (reuse) {
    console.info('[e2e] Reusing the build: no build input changed (E2E_REBUILD=1 to force one).')
  }
  else {
    execSync('pnpm nuxt build', { cwd: rootDir, stdio: 'inherit' })
    writeFileSync(FINGERPRINT_FILE, fingerprint)
  }

  const port = await freePort()
  const server = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: rootDir,
    // The Sample data page (D94) is on, like local and staging, so its tests can reach it.
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NUXT_PUBLIC_SAMPLE_DATA_ENABLED: 'true', NUXT_PUBLIC_SAMPLE_DATA_ENVIRONMENT: 'Test' },
    stdio: 'ignore',
  })
  const host = `http://127.0.0.1:${port}`
  await waitUntilUp(host)
  provide('e2eHost', host)

  return () => {
    server.kill()
  }
}

/** A hash of every build input (paths and contents, in a stable order) and the build's environment. */
function buildFingerprint() {
  const hash = createHash('sha256')
  const add = (path: string) => {
    if (!existsSync(path)) return
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) add(join(path, name))
      return
    }
    hash.update(relative(rootDir, path).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(readFileSync(path))
    hash.update('\0')
  }
  for (const input of BUILD_INPUTS) add(join(rootDir, input))
  const env = Object.entries(process.env)
    .filter(([key]) => key.startsWith('NUXT_') || key === 'NODE_ENV')
    .sort(([a], [b]) => a.localeCompare(b))
  hash.update(JSON.stringify(env))
  return hash.digest('hex')
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    }).on('error', reject)
  })
}

async function waitUntilUp(host: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(host)).ok) return
    }
    catch {
      // not listening yet
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`e2e server did not start on ${host}`)
}
