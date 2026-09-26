# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

`nuk-cafe-admin` is an early-stage admin app built on Nuxt 4 + Nuxt UI v4 (Tailwind CSS v4), with Valibot available for schema validation. It is currently close to a bare scaffold: `app/app.vue` renders `<UApp><NuxtLayout><NuxtPage /></NuxtLayout></UApp>`, but no `app/pages/`, `app/layouts/`, `server/`, or `test/` directories exist yet. Expect to create them following Nuxt 4 conventions (source lives under `app/`, server code under `server/`).

## Commands

Package manager is **pnpm** (`packageManager` pinned in `package.json`; build-script allowlist in `pnpm-workspace.yaml`).

```bash
pnpm install          # also runs `nuxt prepare` (postinstall) to regenerate .nuxt/
pnpm dev              # dev server at http://localhost:3000
pnpm build            # production build
pnpm preview          # preview production build
pnpm lint             # ESLint (also enforces formatting)
pnpm lint:fix
pnpm typecheck        # nuxt typecheck
pnpm test             # vitest run (all projects)
```

Running a subset of tests:

```bash
pnpm vitest run --project unit            # one Vitest project: unit | nuxt | e2e
pnpm vitest run test/unit/foo.test.ts     # single file
pnpm vitest run -t "test name"            # by test name
```

## Tooling notes

- **Formatting is done by ESLint, not Prettier.** `@nuxt/eslint` is configured in `nuxt.config.ts` with `stylistic: true` and `formatters: true`; `.vscode/settings.json` disables Prettier and fixes on save via ESLint. Run `pnpm lint:fix` rather than a formatter.
- `eslint.config.mjs` and `tsconfig.json` import/reference generated files in `.nuxt/`. If lint or typecheck fails with missing-module errors, run `pnpm nuxt prepare` (or `pnpm install`) to regenerate them.
- **Tests** (`vitest.config.ts`) are split into three Vitest projects by directory, and a test file only runs if it lives in the matching folder:
  - `test/unit/*.{test,spec}.ts` — plain Node environment, no Nuxt runtime.
  - `test/nuxt/*.{test,spec}.ts` — `nuxt` environment from `@nuxt/test-utils` (auto-imports, components, composables available; happy-dom).
  - `test/e2e/*.{test,spec}.ts` — Node environment, intended for `@nuxt/test-utils/e2e` with `playwright-core`.
- **Styling**: global CSS entry is `app/assets/css/tailwind.css` (imports `tailwindcss` and `@nuxt/ui`). Nuxt UI components are auto-registered with the `U` prefix; icons use the Iconify Lucide set (`i-lucide-*`). Nuxt UI component theming via `app.config.ts` / the `ui` prop accepts Tailwind classes (VS Code Tailwind IntelliSense is configured for `ui` attributes and `defineAppConfig`).
