import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

// Tests live next to what they test:
// - feature tests: app/features/<name>/tests/*.test.ts
// - shared code tests: test/unit, test/nuxt, test/e2e
// `*.nuxt.test.ts` runs in the Nuxt environment (auto-imports, components); everything else in plain Node.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts', 'app/features/*/tests/**/*.test.ts'],
          exclude: ['**/*.nuxt.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          environment: 'node',
          // Builds and serves the app once for all e2e files.
          globalSetup: ['test/e2e/support/global-setup.ts'],
          testTimeout: 30_000,
          // expect.poll defaults to 1 s: too short for a cold page (session check → refresh → redirect)
          // while the whole suite runs, which made redirect/title assertions flaky.
          expect: { poll: { timeout: 5_000 } },
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['test/nuxt/**/*.test.ts', 'app/features/*/tests/**/*.nuxt.test.ts'],
          environment: 'nuxt',
        },
      }),
    ],
  },
})
