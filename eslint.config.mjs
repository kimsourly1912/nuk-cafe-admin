// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

// Feature boundaries (see AGENTS.md, "Feature architecture"; why: docs/decisions.md D8):
// - Anything outside a feature imports it only via its public API: '~/features/<name>'.
// - Route files in app/pages may also import a feature's *Page.vue component.
// - Inside a feature, use relative imports; reaching another feature uses '~/features/<name>'.
const FEATURE_ALIAS = String.raw`^(~|@|~~/app)/features/[^/]+/`

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
  // Server boundaries (docs/server/architecture.md → Features):
  // - routes use a feature only through its index.ts;
  // - a feature reaches another feature only through that feature's index.ts;
  // - new code never builds on server/legacy (the pre-standard code being replaced).
  {
    files: ['server/api/**/*.ts', 'server/routes/**/*.ts', 'server/tasks/**/*.ts', 'server/middleware/**/*.ts'],
    ignores: ['server/api/v1/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { regex: String.raw`features/[^/]+/.+`, message: 'Import a server feature through its index.ts: \'~~/server/features/<name>\'.' },
          { regex: String.raw`(^|/)legacy(/|$)`, message: 'server/legacy is being replaced; don\'t build on it (D43).' },
        ],
      }],
    },
  },
  {
    files: ['server/features/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { regex: String.raw`^\.\./[^./][^/]*/.+`, message: 'Reach another server feature only through its index.ts (\'../<feature>\').' },
          { regex: String.raw`(^|/)legacy(/|$)`, message: 'server/legacy is being replaced; don\'t build on it (D43).' },
        ],
      }],
    },
  },
)
