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

// A cafe's pages (D141): `/`, `/admin…`, `/counter…`, `/orders…`, `/checkout` live under `/c/<slug>`.
// Links to them go through `useTenantPath()` (`tenantPath('/admin/products')`); a bare one would
// leave the cafe. API paths (`apiFetch('/admin/…')`) aren't links and aren't checked.
const CAFE_PAGE = String.raw`/^\/(?:admin|counter|orders|checkout)(?:[/?]|$)|^\/$/`
const CAFE_PAGE_START = String.raw`/^\/(?:admin|counter|orders|checkout)(?:[/?$]|$)/`
const CAFE_LINK_MESSAGE = 'A cafe\'s page lives under its address: use tenantPath(\'…\') from useTenantPath() (D141).'
const CAFE_LINK_RESTRICTIONS = [
  `CallExpression[callee.name="navigateTo"] > Literal[value=${CAFE_PAGE}]`,
  `CallExpression[callee.name="navigateTo"] > TemplateLiteral[quasis.0.value.raw=${CAFE_PAGE_START}]`,
  `CallExpression[callee.property.name=/^(?:push|replace)$/] > Literal[value=${CAFE_PAGE}]`,
  `CallExpression[callee.property.name=/^(?:push|replace)$/] > TemplateLiteral[quasis.0.value.raw=${CAFE_PAGE_START}]`,
  `Property[key.name=/^(?:to|path)$/] > Literal[value=${CAFE_PAGE}]`,
  `Property[key.name=/^(?:to|path)$/] > TemplateLiteral[quasis.0.value.raw=${CAFE_PAGE_START}]`,
].map(selector => ({ selector, message: CAFE_LINK_MESSAGE }))

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
  // Drawers and bottom sheets don't drag (ui.md → Overlays): AppDrawer wraps UDrawer, nothing else uses it.
  // A cafe's pages live under its address (D141): links go through `useTenantPath()`.
  {
    files: ['app/**/*.vue'],
    ignores: ['app/components/AppDrawer.vue'],
    rules: {
      'vue/no-restricted-html-elements': ['error', { element: ['UDrawer'], message: 'Use <AppDrawer>: drawers don\'t drag (ui.md → Overlays).' }],
      'vue/no-restricted-static-attribute': ['error', { key: 'to', value: CAFE_PAGE, message: CAFE_LINK_MESSAGE }],
      'no-restricted-syntax': ['error',
        { selector: 'CallExpression[callee.name="resolveComponent"][arguments.0.value="UDrawer"]', message: 'Use AppDrawer: drawers don\'t drag (ui.md → Overlays).' },
        { selector: 'ImportSpecifier[imported.name="UDrawer"]', message: 'Use AppDrawer: drawers don\'t drag (ui.md → Overlays).' },
        ...CAFE_LINK_RESTRICTIONS,
      ],
    },
  },
  {
    files: ['app/**/*.ts'],
    // Features name their sidebar entries inside the cafe; the layout gives them its address.
    ignores: ['app/features/*/navigation.ts', 'app/utils/navigation.ts', 'app/**/tests/**'],
    rules: {
      'no-restricted-syntax': ['error', ...CAFE_LINK_RESTRICTIONS],
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
  // A schema may reference another feature's table for a foreign key (D134: `(tenant_id, branch_id)`
  // → branches), importing its *.schema.ts directly: a feature's index.ts reaches the database
  // through hub:db:schema, which is built from these files.
  {
    files: ['server/features/*/*.schema.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        ...SERVER_IMPORTS,
        {
          regex: String.raw`^#server/features/[^/]+/(?![^/]+\.schema(?:\.ts)?$).+`,
          message: 'A schema imports another feature only for its table: #server/features/<name>/<name>.schema.',
        },
      ] }],
    },
  },
)
