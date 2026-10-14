# Development

Task-specific instructions extracted from the former root guide. Read applicable sections via [task routing](../../AGENTS.md#load-context-for-the-task); do not load all guides at startup. Linked reference pages own API signatures and detailed behavior.

## Commands

Package manager is **pnpm**.

```bash
pnpm dev                                  # http://localhost:3000; /api is local Nitro/Better Auth
pnpm nuxt db generate                     # create a migration after changing the server schema
pnpm nuxt db migrate                      # apply local SQLite migrations
pnpm lint / pnpm lint:fix                 # ESLint also does formatting (no Prettier) and enforces feature boundaries
pnpm typecheck                            # vue-tsc via nuxt typecheck
pnpm test                                 # all Vitest projects
pnpm test:unit / pnpm test:e2e            # unit + server (seconds) / e2e only (about two minutes, builds the app)
pnpm vitest run --project server          # one project: unit | server | e2e (| nuxt, once a *.nuxt.test.ts exists)
pnpm vitest run app/features/categories   # one feature's tests
pnpm vitest run -t "refreshes once"
```

The browser suite uses the CI runner's Google Chrome by default. In a workspace with Chromium instead, use `E2E_BROWSER_PATH=/usr/bin/chromium pnpm test:e2e`; the optional executable path changes only the test browser launcher, not application behavior.

**Checks (D83):**
- **Before opening a PR, locally:** `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, and the e2e files of the feature you changed (`pnpm vitest run --project e2e test/e2e/<feature>.test.ts`). The e2e build is reused while no build input changed (`E2E_REBUILD=1` forces one), so rerunning tests or taking screenshots costs no rebuild.
- **The full suite runs in CI** (`.github/workflows/ci.yml`: lint, typecheck, audit, unit/server, e2e in 3 shards) on every PR. A merge to `main` deploys to staging **without running them again** (D133): the PR already checked its code merged with `main` as it was. If `main` moved after the PR's checks ran (another PR merged meanwhile), press **Update branch** on the PR so its checks run on the new `main` before merging, or run the workflow on `main` by hand afterwards (Actions → CI → Run workflow). A shared building block or app-wide change (a root composable, `app.config.ts`, a plugin) also runs the full `pnpm test:e2e` locally first.
- **Merge only when the PR's checks are green.** A red PR is fixed on the same PR; a failed staging deploy or a red manual run on `main` is fixed before any new work.
- **"Remove the guard and see the test fail"** is required for new guards (locks, permissions, money, idempotency, version checks); optional elsewhere.
- **Docs per step:** one `decisions.md` entry and the step's line in `progress.md`; reference pages only when a shared building block or a rule changes.

Local setup for a first admin: [docs/reference/auth.md → First admin](../reference/auth.md#first-admin-local-setup).

Commit messages: say what changed in the subject (`Add cross-tab logout`, `Fix open redirect after login`), not `new`. The history is how the team finds when something broke. If lint or typecheck complains about missing `.nuxt/*` files, run `pnpm nuxt prepare`.

## Adding a full stack feature

1. Start from the user journeys in [the system blueprint](../plans/system-blueprint.md) and write a plan with [docs/feature-standard.md](../feature-standard.md). Settle any unresolved business or permission rule first, or defer that behavior; never encode a guess.
2. The server side per the [server standard](../server/README.md): contracts in `shared/contracts/<domain>.ts`; the feature in `server/features/<feature>/` (schema + migration, repository, service, errors, types); thin routes under the right surface; permissions in the identity feature.
3. Server tests in the feature's `tests/` against SQLite built from the migrations: rules, each error code, permission cases, and a stale-version / race / replay case for every guarded or idempotent write (check that it fails with the guard removed).
4. The feature folder in `app/features/<feature>/` (copy Categories for composables/forms, Menu items for paginated lists), calling `apiFetch` through `useApiQuery` / `useMutation`.
5. Browser tests in `test/e2e/<feature>.test.ts` with `mockApi` and the typed fixtures in `test/e2e/support/mock-api.ts`.
6. Update the server standard where it changed, the feature's reference page, progress.md and decisions.md.

## Tests

`vitest.config.ts` projects:
- **unit** (`test/unit`, `app/features/*/tests`): pure logic in Node: engines, form schemas and mappings.
- **server** (`server/features/*/tests`, shared utils in `server/tests`): services against an in-memory SQLite database built from the checked-in migrations, foreign keys on (D42).
- **e2e** (`test/e2e`): builds the app once and drives Chrome. Admin tests mock the API in the browser (`mockApi`); the customer site's tests read a real database seeded before each run (`test/e2e/support/seed.ts`, the Standard sample menu, D95), because the server renders those pages.
- **nuxt**: only created once a `*.nuxt.test.ts` exists (D42).

## Conventions

- Prefer Nuxt-native tools (`useAsyncData`, `useState`, `useRuntimeConfig`, route middleware), then `@vueuse/core` (import it explicitly: it isn't auto-imported), before adding a library or hand-rolling a utility. There is no Pinia: shared state is `useState` inside a composable.
- Define new API contracts in project-owned code. Import Valibot as `import * as v from 'valibot'`.
- **Local build modules** live in `modules/` (Nuxt registers them): today only `reka-namespaced.ts`, which keeps Reka UI's namespaced barrel from bundling the admin's calendar into the customer menu (D123). Import Nuxt's kit as `nuxt/kit` (pnpm doesn't let the app import `@nuxt/kit` or `vite`).
- Icons are bundled at build time, never fetched (decisions D18). Write icon names as literal strings (`'i-lucide-tags'`), not template strings, and install `@iconify-json/<collection>` before using a new collection.
- `USelect` cannot hold an empty or `undefined` value. Use `ANY` for "all" filters and let the `<Feature>Select` components handle "none".
- **Dropdowns (owner, 2026-10-02, D126):** the cafe's records (categories, branches, rules, add-on groups, staff) or a long list use `<RecordSelect>` (search and virtual scroll, `pinned` "All"/"None"); `USelect` only for a fixed set the code defines (status, role, sort). See [ui.md §14](../reference/ui.md#14-dropdowns-owner-2026-10-02-d126).
- **Tabs, pages and quantities (D128):** tab labels are never cut: a row that doesn't fit scrolls and centers the active tab (`useCenteredTab`); every paginated list ends with `<ListPagination>`; every quantity is a `<QuantityStepper>`, never `UInputNumber` ([ui.md §15–16](../reference/ui.md#16-pagination-and-quantities-owner-2026-10-02-d128)).
- **Page width (D126):** admin pages set no max-width or width breakpoints: the shell centers them at 80rem; a settings or form page adds `class="page-narrow"` (56rem) to its `UDashboardPanel` ([ui.md §13](../reference/ui.md#13-page-width-owner-2026-10-02-d126)). Drawers and sheets are `<AppDrawer>`; tabs in a toolbar are `<ToolbarTabs>` with `useUrlTab`.
- **Design system first (owner, 2026-09-28, D74).** Mockups are a reference for layout, element positions and content, not for styling; Nuxt UI defaults and global configuration decide styling. The rules are in [ui.md](../reference/ui.md). When a mockup needs something the design system lacks, ask first.
- The UI chrome is English only. Translatable content fields (`nameI18n`, ...) are data, preserved on update.
