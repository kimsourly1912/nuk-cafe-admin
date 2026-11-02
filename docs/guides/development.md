# Development

Task-specific instructions extracted from the former root guide. Read applicable sections via [task routing](../../AGENTS.md#load-context-for-the-task); do not load all guides at startup. Linked reference pages own API signatures and detailed behavior.

## Commands

Package manager is **pnpm**.

### Node.js and pnpm (D205)

`package.json` owns `engines.node` (`^24.22.1`, patched Node 24 only) and `packageManager` (exactly `pnpm@12.15.0`). Install a matching Node release, enable Corepack's pnpm shim, and use `pnpm install --frozen-lockfile`; see the [Windows setup](../../README.md#windows-11-powershell). These declarations do not automatically switch the machine's Node installation. Check `node --version` and `pnpm --version` before running checks; do not assume a successful install enforces the root project's Node requirement (reproduced with pnpm 12).

All three CI setup jobs read `engines.node` from the checked-out manifest and pass it to the existing pinned `pnpm/setup` action. That action reads `packageManager` and performs the frozen install in CI. The Node range permits later Node 24 patches without permitting another major. No additional version files or runtime download configuration are needed. The lockfile's first YAML document pins pnpm's bootstrap binaries; its second document locks application dependencies. A pnpm-only upgrade can change the first while leaving the second untouched.

Node.js is for local development, tests, and builds. Deployed environments run on Workers. Optional Cloudflare-hosted builds need their own `NODE_VERSION` build setting; see [operations](../server/operations.md#build-toolchain). Toolchain changes never authorize a deployment. Security findings and verification: [audit](../reviews/toolchain-audit-2026-10-25.md).

### Application commands

```bash
pnpm dev                                  # http://localhost:3000; /api is local Nitro/Better Auth
pnpm nuxt db generate                     # create a migration after changing the server schema
pnpm nuxt db migrate                      # apply local SQLite migrations
pnpm lint / pnpm lint:fix                 # ESLint also does formatting (no Prettier) and enforces feature boundaries; cached (D172)
pnpm audit --audit-level high             # same dependency security gate as CI; refresh before opening/updating a PR
pnpm typecheck                            # vue-tsc via nuxt typecheck
pnpm test                                 # all Vitest projects
pnpm test:unit / pnpm test:e2e            # unit + server (~30 s idle, D174) / e2e only (~7–11 min locally at 4 workers, +35 s idle when the build is stale, D177)
pnpm test:changed                         # unit + server tests reached by files changed since origin/main (2–10 s for one edit, D175)
pnpm test:fast                            # unit + server without the `slow` tag (~26 s idle)
pnpm vitest --project server server/tests/health.test.ts   # watch mode: reruns on save
pnpm vitest run --project server          # one project: unit | server | e2e (| nuxt, once a *.nuxt.test.ts exists)
pnpm vitest run app/features/categories   # one feature's tests
pnpm vitest run -t "refreshes once"
```

**Which test command (D175):** while working, watch the file you're changing (`pnpm vitest --project server <path>`) or run `pnpm test:changed` after an edit. It follows imports, dynamic ones too, from every changed file: committed since `origin/main` (fetch first if it's old), staged and unstaged. It **ignores untracked files**, so `git add` a new file first. A change to `package.json`, `vitest.config.ts` or a migration runs everything. `pnpm test:fast` skips the `slow` tests (large data, whole sample menus, migration replays, password hashing); on an idle machine it saves only a few seconds, more while other checks run. Before a PR it is still the full `pnpm test:unit` (Checks below).

**Local e2e runs 4 files at a time (D172):** each file opens its own Chrome, and more workers starved them (Chrome launches past the 60 s hook timeout, cross-tab tests timing out). `E2E_WORKERS=<n>` overrides it; CI keeps Vitest's default.

**The local e2e build is untraced (D177):** its server imports dependencies from this checkout's `node_modules` instead of copying them into `.output`, so a stale build takes about 35 s on an idle laptop instead of 2–3 min. Only the e2e server can run it, from this checkout. CI builds traced, like a deployment; `E2E_TRACE=1` does the same locally if you suspect a problem only tracing would show. Switching between them rebuilds. ESLint caches results in `node_modules/.cache/eslint/` by file content; delete that folder if lint ever looks stale.

The browser suite uses the CI runner's Google Chrome by default. In a workspace with Chromium instead, use `E2E_BROWSER_PATH=/usr/bin/chromium pnpm test:e2e`; the optional executable path changes only the test browser launcher, not application behavior.

**Checks (D83):**
- **Before opening a PR, locally:** `pnpm lint`, `pnpm typecheck`, `pnpm audit --audit-level high`, `pnpm test:unit`, and the e2e files of the feature you changed (`pnpm vitest run --project e2e test/e2e/<feature>.test.ts`). Run the audit again when updating the PR: advisory data can change while the lockfile stays the same. The e2e build is reused while no build input changed (`E2E_REBUILD=1` forces one), so rerunning tests or taking screenshots costs no rebuild; after a source edit the rebuild takes about 35 s (D177). It also rebuilds when `node_modules/@nuxthub/db/db.mjs` no longer points at the e2e database: `nuxt typecheck`, `nuxt prepare` and `pnpm dev` rewrite that file for the dev database, and a reused build's server would then answer every page 500, "no such table" (D249).
- **The full suite runs in CI** (`.github/workflows/ci.yml`: lint, typecheck, audit, unit/server, e2e in 3 shards) on every PR. A merge to `main` deploys to staging **without running them again** (D133): the PR already checked its code merged with `main` as it was. If `main` moved after the PR's checks ran (another PR merged meanwhile), press **Update branch** on the PR so its checks run on the new `main` before merging, or run the workflow on `main` by hand afterwards (Actions → CI → Run workflow). A shared building block or app-wide change (a root composable, `app.config.ts`, a plugin) also runs the full `pnpm test:e2e` locally first.
- **Merge only when the PR's checks are green.** A red PR is fixed on the same PR; a failed staging deploy or a red manual run on `main` is fixed before any new work.
- **"Remove the guard and see the test fail"** is required for new guards (locks, permissions, money, idempotency, version checks); optional elsewhere.
- **Docs per step:** one `decisions.md` entry and the step's line in `progress.md`; reference pages only when a shared building block or a rule changes.

Local setup on a fresh database (D220): `pnpm dev:accounts`. Accounts for every role (super admin, owner, manager, staff, customer, a second cafe's owner) and password resets: `pnpm dev:accounts`, `pnpm dev:reset <email>`, `pnpm dev:mail` ([Test accounts](../reference/auth.md#test-accounts-local-dev)).

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
- **server** (`server/features/*/tests`, shared utils in `server/tests`): services against an in-memory SQLite database built from the checked-in migrations, foreign keys on (D42). The project's global setup runs the migrations once per run and `createTestDb()` replays a dump of the result (schema and rows, ~14 ms instead of ~230 ms, D174); `test-db.test.ts` checks the dump equals a migrated database. Tests of one migration use `createTestClient()` + `applyMigration()`. Both close their database after the test that opened it, or after the file when it was opened in `beforeAll` (`server/tests/support/setup.ts`): libsql crashes the worker when it frees one left open (D176). A test whose own work is heavy (data at the contracts' limits, a whole sample menu, migrations replayed, several password hashes) and takes over ~1 s idle gets the `slow` tag (`{ tags: ['slow'] }` on the test or describe, or `// @module-tag slow` atop the file): 60 s instead of 5 s, skipped by `test:fast` (D175). A slow import or setup gets fixed, not tagged.
- **e2e** (`test/e2e`): builds the app once and drives Chrome. Admin tests mock the API in the browser (`mockApi`); the customer site's tests read a real database seeded before each run (`test/e2e/support/seed.ts`, the Standard sample menu, D95), because the server renders those pages.
- **nuxt**: only created once a `*.nuxt.test.ts` exists (D42).

**When an e2e test fails (D249):** every page the test opened is saved under `test-results/e2e/<file> - <test>/` (`page-N.png` full-page screenshot, `page-N.html`, `page-N.txt` with the address and title; `test/e2e/support/failure-capture.ts`, set up by `setupE2e`). Locally, open the folder. In CI, a failed e2e shard uploads it as the artifact **e2e-failures-<shard>** (Actions → the run → Artifacts, kept 14 days). Look there before calling a failure flaky: a timeout says only that something didn't appear, the screenshot says what was there instead.

**What the browser reported (D251):** after every e2e test, each page it left open is checked for what no assertion looks at: a console error, any message about hydration, an uncaught error, a request to our own server that failed (not an abort) or answered 5xx (`test/e2e/support/browser-problems.ts`). A passing test that has one fails, with the same capture plus `page-N.problems.txt`; a failing test's capture includes it too. Chrome's "Failed to load resource" lines and 4xx answers are left out (a 401 or 404 is often the expected answer); other sites' requests too. A test that causes a problem on purpose (a mocked 500, a cut network) allows it inside the test with a narrow pattern: `allowBrowserProblems(/POST \/api\/c\/nuk\/admin\/categories → 500/)`. Fix anything else rather than allowing it. Limits: Playwright keeps the last 200 messages and 100 requests per page, and a page the test closed itself isn't checked.

**Hydration in the e2e build (D251):** a production build logs a hydration mismatch only as "Hydration completed but contains mismatches.", without the element. The e2e build (`E2E_HUB_DIR` set) adds `debug: { hydration: true }`, which keeps Vue's detailed `[Vue warn]: Hydration … mismatch` with the element; deployed builds don't have it. Only server-rendered pages hydrate (`/`, `/c/<slug>`, the account pages); `ssr: false` routes can't mismatch. `pnpm typecheck` can't find one (it checks types, not what the server and the browser rendered), and a green e2e run says nothing about pages and states no test opened. To see one in full while developing, open the page under `pnpm dev`: the console shows the warning with the component trace.

### Browser evidence for agents: Chrome DevTools MCP (D252)

An agent can drive a real Chrome and read what it reports: console messages with source-mapped stacks, DevTools issues, network requests with status and bodies, performance traces, Lighthouse (accessibility, SEO, best practices), screenshots and accessibility snapshots. Use it to investigate a browser problem before changing code; it is a local tool, not a check: CI and the e2e suite stay the gate (D251).

**Setup:** the `chrome-devtools` server is in the project's `.mcp.json`, running the pinned dev dependency `chrome-devtools-mcp` (`pnpm exec`, no download at start; upgrades go through the upgrade workflow). Claude Code asks each person once before starting a project server. Codex and other clients: add the same command and arguments to their own MCP config (not verified in this repo). Needs Google Chrome (or Chrome for Testing) 149+ for the address allowlist. On a machine without a display, set `CHROME_DEVTOOLS_MCP_HEADLESS=true` before starting the agent (a Claude Code cloud session: the environment's variables); the default opens a visible window, and without a display its first tool call fails with "Missing X server to start the headful browser".

**What the configuration enforces:**
- **Local addresses only:** `--allowedUrlPattern` admits `http://localhost:*/*` and `http://127.0.0.1:*/*`; staging, production and other sites are refused ("blocked by blocklist/allowlist rules"). Point it at `pnpm dev` (`http://localhost:3000`) or a local production build.
- **A throwaway profile** (`--isolated`): no saved sign-ins or cookies from your own browser. Sign in with the dev accounts (`pnpm dev:accounts`), never a real person's.
- **Cookies and authorization headers redacted** from what the agent reads (`--redactNetworkHeaders`).
- **Nothing sent to Google** from it: no usage statistics (`--no-usage-statistics`), no CrUX lookups of traced addresses (`--no-performance-crux`), no update checks (`CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS`).
- Everything the page shows still reaches the agent's model: local sample data only. These flags guard against mistakes; an agent that edits `.mcp.json` can change them, which code review must catch.

**Workflow for a problem the e2e check reported** (`page-N.problems.txt`) **or one seen by hand:**
1. `pnpm dev`, then `navigate_page` to the page; `emulate` or `resize_page` to the test's width (hydration problems are often phone-only).
2. `list_console_messages` (warnings and errors; under `pnpm dev` Vue's hydration warning includes the component trace), `get_console_message` for the stack and an issue's affected element.
3. For hydration: `evaluate_script` with `async () => (await fetch(location.href)).text()` gives the server's HTML; compare the element with the hydrated DOM (`take_snapshot` or `evaluate_script` reading `outerHTML`).
4. For a request: `list_network_requests`, then `get_network_request` for its body and status.
5. Fix in code, then prove it with the e2e test (the shared check fails without the fix).

DevTools **issues** (for example "A form field element should have an id or name attribute") appear in `list_console_messages` but not in the e2e check, which reads console messages only.

### Bundle and Worker size (D253)

A manual check, run when a change adds a dependency, a heavy component, or a page customers open on phones; not in CI. Three questions, three commands; record the numbers in the step's progress entry, compared with the last baseline ([D253](../decisions.md#d253-bundle-and-worker-size-are-measured-by-hand-with-a-recorded-baseline-2026-11-02)).

**1. What is in the client bundle:** `pnpm analyze` (`nuxt analyze --no-serve`, then `scripts/analyze-report.mjs`): the largest packages, features and chunks by gzip, as text. The treemap is `node_modules/.cache/nuxt/.nuxt/analyze/client.html` (open it in a browser; Chrome DevTools MCP can't, it allows local addresses only). Its `nitro.html` is the **Node** server build, not the Worker: ignore it for Worker size.
- It is a full production build: it replaces `.output` (the next local e2e run rebuilds), rewrites `node_modules/@nuxthub/db/db.mjs` (the e2e setup notices, D249), and **applies migrations to the dev database** `.data/db` (it fails there if that database is inconsistent).

**2. What a page needs on a first visit:** serve that build with data (`node .output/server/index.mjs`; for the menu, a cafe with a menu, e.g. the Sample data page under `pnpm dev` first), then `node scripts/page-weight.mjs http://localhost:3000 /c/<slug>:390 /c/<slug>:1440 /sign-in:390`. It separates what the page loads to render from Nuxt's idle `prefetch` hints for other pages (a request count in DevTools mixes them), and computes gzip from the built files: Cloudflare may send brotli, slightly smaller.

**3. The Worker:** `pnpm build:staging`, then:
```bash
pnpm exec wrangler deploy --dry-run --outdir /tmp/worker-dry --config .output/server/wrangler.json
```
`Total Upload` is what Cloudflare limits: **64 MiB uncompressed** on every plan; the gzip figure is no longer a limit (Cloudflare, 2026-09-04). The tighter limit is **startup, 1 second** of CPU for the Worker's top-level code:
```bash
pnpm exec wrangler check startup --config .output/server/wrangler.json --outfile /tmp/worker-startup.cpuprofile
```
It runs the Worker locally and prints the active time; a local CPU differs from Cloudflare's, so compare it with the last baseline on a similar machine, not with the limit alone. The profile opens in Chrome DevTools' Performance panel. Neither command deploys or needs Cloudflare credentials.

## Conventions

- Prefer Nuxt-native tools (`useAsyncData`, `useState`, `useRuntimeConfig`, route middleware), then `@vueuse/core` (import it explicitly: it isn't auto-imported), before adding a library or hand-rolling a utility. There is no Pinia: shared state is `useState` inside a composable.
- Define new API contracts in project-owned code. Import Valibot as `import * as v from 'valibot'`.
- **Local build modules** live in `modules/` (Nuxt registers them): none today (`reka-namespaced.ts` was removed with Nuxt UI 4.12, D123). Import Nuxt's kit as `nuxt/kit` (pnpm doesn't let the app import `@nuxt/kit` or `vite`).
- Icons are bundled at build time, never fetched (decisions D18). Write icon names as literal strings (`'i-lucide-tags'`), not template strings, and install `@iconify-json/<collection>` before using a new collection. A running `pnpm dev` doesn't pick up a newly used icon (it shows blank, "[Icon] failed to load icon" in the console): restart it.
- `USelect` cannot hold an empty or `undefined` value. Use `ANY` for "all" filters and let the `<Feature>Select` components handle "none".
- **Dropdowns (owner, 2026-10-02, D126):** the cafe's records (categories, branches, rules, add-on groups, staff) or a long list use `<RecordSelect>` (search and virtual scroll, `pinned` "All"/"None"); `USelect` only for a fixed set the code defines (status, role, sort). See [ui.md §14](../reference/ui.md#14-dropdowns-owner-2026-10-02-d126).
- **Tabs, pages and quantities (D128):** tab labels are never cut: a row that doesn't fit scrolls and centers the active tab (`useCenteredTab`); every paginated list ends with `<ListPagination>`; every quantity is a `<QuantityStepper>`, never `UInputNumber` ([ui.md §15–16](../reference/ui.md#16-pagination-and-quantities-owner-2026-10-02-d128)).
- **Page width (D126):** admin pages set no max-width or width breakpoints: the shell centers them at 80rem; a settings or form page adds `class="page-narrow"` (56rem) to its `UDashboardPanel` ([ui.md §13](../reference/ui.md#13-page-width-owner-2026-10-02-d126)). Drawers and sheets are `<AppDrawer>`; tabs in a toolbar are `<ToolbarTabs>` with `useUrlTab`.
- **Design system first (owner, 2026-09-28, D74).** Mockups are a reference for layout, element positions and content, not for styling; Nuxt UI defaults and global configuration decide styling. The rules are in [ui.md](../reference/ui.md). When a mockup needs something the design system lacks, ask first.
- The UI chrome is English only. Translatable content fields (`nameI18n`, ...) are data, preserved on update.
