# Workflow: commands, checks and commits

> **Purpose:** how to run the project, what to check before a PR and when to merge, commit message style, and the steps for a full stack feature after the first. Read it when running checks, opening a PR, committing, or finishing a step. Moved verbatim from AGENTS.md (links and `progress.md` retargeted to this layout).

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

**Checks (D83):**
- **Before opening a PR, locally:** `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, and the e2e files of the feature you changed (`pnpm vitest run --project e2e test/e2e/<feature>.test.ts`). The e2e build is reused while no build input changed (`E2E_REBUILD=1` forces one), so rerunning tests or taking screenshots costs no rebuild.
- **The full suite runs in CI** (`.github/workflows/ci.yml`: lint, typecheck, audit, unit/server, e2e in 3 shards) on every PR. A merge to `main` deploys to staging **without running them again** (D133): the PR already checked its code merged with `main` as it was. If `main` moved after the PR's checks ran (another PR merged meanwhile), press **Update branch** on the PR so its checks run on the new `main` before merging, or run the workflow on `main` by hand afterwards (Actions → CI → Run workflow). A shared building block or app-wide change (a root composable, `app.config.ts`, a plugin) also runs the full `pnpm test:e2e` locally first.
- **Merge only when the PR's checks are green.** A red PR is fixed on the same PR; a failed staging deploy or a red manual run on `main` is fixed before any new work.
- **Docs per step:** one `decisions.md` entry and the step's line in `status.md`; reference pages only when a shared building block or a rule changes.

Local setup for a first admin: [docs/reference/auth.md → First admin](reference/auth.md#first-admin-local-setup).

Commit messages: say what changed in the subject (`Add cross-tab logout`, `Fix open redirect after login`), not `new`. The history is how the team finds when something broke. If lint or typecheck complains about missing `.nuxt/*` files, run `pnpm nuxt prepare`.

## Adding a full stack feature: steps 2 to 6

_Step 1 of this list ("Start from the user journeys…, settle any unresolved business or permission rule first…") is in AGENTS.md._

2. The server side per the [server standard](server/README.md): contracts in `shared/contracts/<domain>.ts`; the feature in `server/features/<feature>/` (schema + migration, repository, service, errors, types); thin routes under the right surface; permissions in the identity feature.
3. Server tests in the feature's `tests/` against SQLite built from the migrations: rules, each error code, permission cases, and a stale-version / race / replay case for every guarded or idempotent write (check that it fails with the guard removed).
4. The feature folder in `app/features/<feature>/` (copy Categories for composables/forms, Menu items for paginated lists), calling `apiFetch` through `useApiQuery` / `useMutation`.
5. Browser tests in `test/e2e/<feature>.test.ts` with `mockApi` and the typed fixtures in `test/e2e/support/mock-api.ts`.
6. Update the server standard where it changed, the feature's reference page, status.md and decisions.md.
