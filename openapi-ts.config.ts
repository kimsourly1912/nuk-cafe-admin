import { defineConfig } from '@hey-api/openapi-ts'

// Generates the typed API layer in app/generated/api/ from the backend's OpenAPI spec.
// Run `pnpm api:generate` whenever the backend changes. Never edit the output by hand.
export default defineConfig({
  input: process.env.OPENAPI_URL ?? 'https://dev-api.nukcafe.co/nukcafe/api/v2/api-docs',
  output: {
    path: 'app/generated/api',
    // The output is committed; linting/formatting it would only create noise.
    postProcess: [],
  },
  parser: {
    filters: {
      // Admin portal only talks to back-office endpoints.
      operations: {
        include: ['/^[A-Z]+ \\/(staff|admin)(\\/|$)/'],
      },
    },
  },
  plugins: [
    { name: '@hey-api/client-ofetch', throwOnError: true },
    '@hey-api/typescript',
    '@hey-api/sdk',
    // Valibot schemas for every component schema (e.g. vCategoryRecordCreation), reused by forms.
    'valibot',
  ],
})
