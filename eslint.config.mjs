// @ts-check
import { readdirSync } from 'node:fs'
import withNuxt from './.nuxt/eslint.config.mjs'

// Feature boundaries (see AGENTS.md, "Feature architecture"; why: docs/decisions.md D8):
// - Anything outside a feature imports it only via its public API: '~/features/<name>'.
// - Route files in app/pages may also import a feature's *Page.vue component.
// - Inside a feature, use relative imports; reaching another feature uses '~/features/<name>'.
const FEATURE_ALIAS = String.raw`^(~|@|~~/app)/features/[^/]+/`

// Server aliases are a project convention; Nuxt also supports relative imports.
const SERVER_IMPORTS = [
  { regex: String.raw`^\.\./|^\./[^/]+/`, message: 'Use #server/ or #shared/ instead of relative server directory imports.' },
  { regex: String.raw`^(~~|@@)/(server|shared)(/|$)|^(~|@)/server(/|$)`, message: 'Use the Nuxt #server/ or #shared/ alias.' },
]
const FEATURE_INTERNAL = String.raw`^#server/features/[^/]+/(?!index(?:\.ts)?$).+`
const dynamicRestrictions = patterns => patterns.map(({ regex, message }) => ({
  selector: `ImportExpression[source.value=/${regex.replaceAll('/', '\\u002F')}/]`,
  message,
}))
const featureNames = readdirSync(new URL('./server/features/', import.meta.url), { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name)

export default withNuxt(
  {
    files: ['app/**/*.{ts,vue}'],
    ignores: ['app/pages/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            regex: FEATURE_ALIAS,
            message: 'Import features through their public API: \'~/features/<name>\'.',
          },
          {
            regex: String.raw`^\.\./\.\./`,
            message: 'Don\'t reach into other features with relative paths; use \'~/features/<name>\'.',
          },
        ],
      }],
    },
  },
  {
    files: ['app/pages/**/*.vue'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: String.raw`${FEATURE_ALIAS}(?!components/\w+Page\.vue$)`,
          message: 'Pages may import a feature\'s public API or its *Page.vue component only.',
        }],
      }],
    },
  },
  // Server imports (docs/server/architecture.md → Imports and aliases).
  {
    files: ['server/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: SERVER_IMPORTS }],
      'no-restricted-syntax': ['error', ...dynamicRestrictions(SERVER_IMPORTS)],
    },
  },
  {
    files: ['server/api/**/*.ts', 'server/routes/**/*.ts', 'server/tasks/**/*.ts', 'server/middleware/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        ...SERVER_IMPORTS,
        { regex: FEATURE_INTERNAL, message: 'Import a server feature through its index.ts: #server/features/<name>.' },
      ] }],
      'no-restricted-syntax': ['error', ...dynamicRestrictions([
        ...SERVER_IMPORTS,
        { regex: FEATURE_INTERNAL, message: 'Import a server feature through its index.ts: #server/features/<name>.' },
      ])],
    },
  },
  // Each feature may import its own internals; other features expose only index.ts.
  // Tests/evaluations intentionally inspect internals and fixtures.
  ...featureNames.map(name => ({
    files: [`server/features/${name}/**/*.ts`],
    ignores: [`server/features/${name}/tests/**`, `server/features/${name}/eval/**`],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        ...SERVER_IMPORTS,
        {
          regex: String.raw`^#server/features/(?!${name}(?:/|$))[^/]+/(?!index(?:\.ts)?$).+`,
          message: 'Reach another server feature only through #server/features/<name>.',
        },
      ] }],
      'no-restricted-syntax': ['error', ...dynamicRestrictions([
        ...SERVER_IMPORTS,
        {
          regex: String.raw`^#server/features/(?!${name}(?:/|$))[^/]+/(?!index(?:\.ts)?$).+`,
          message: 'Reach another server feature only through #server/features/<name>.',
        },
      ])],
    },
  })),
)
