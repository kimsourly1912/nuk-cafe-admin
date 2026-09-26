import { execSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    e2eHost: string
  }
}

const rootDir = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * Builds the app once and serves it for every e2e file (`setup({ host: inject('e2eHost') })`),
 * instead of `@nuxt/test-utils` building once per file. Runs only when the e2e project runs.
 */
export default async function ({ provide }: TestProject) {
  execSync('pnpm nuxt build', { cwd: rootDir, stdio: 'inherit' })

  const port = await freePort()
  const server = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: rootDir,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  })
  const host = `http://127.0.0.1:${port}`
  await waitUntilUp(host)
  provide('e2eHost', host)

  return () => {
    server.kill()
  }
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
