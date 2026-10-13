# Project instructions

Shared rules for Codex, Claude Code and other coding agents. NUK Cafe is one Nuxt full stack app: customer ordering, cafe admin, counter and platform console. Stack: Nitro, Better Auth, NuxtHub, Drizzle, local SQLite and Cloudflare D1/R2/KV; Nuxt UI and Tailwind; pnpm, Valibot, Vitest. No Pinia, Spring SDK, proxy or legacy envelopes.

## Essential rules

- Preserve security, permissions, payment and data integrity. Unresolved business or authorization policy is an owner decision: record the question, continue independent work and defer affected behavior; never encode a guess.
- A Better Auth organization is a **cafe/tenant**, not a branch (D135). Tenant-owned rows carry `tenant_id`; every query names the tenant; relationships stay within it. New tables/queries need a two-cafe isolation test. Permissions are checked on the server; platform superadmins do not gain access to cafe data.
- Cafe pages use `/c/<slug>/…`, cafe APIs `/api/c/<slug>/…`. Use `useTenantPath()` for links and `apiFetch` for our API; changing cafes is a full page load. Account pages, `/cafes`, `/table/<token>` and `/platform/**` are platform routes. `/admin` and `/counter` below mean paths inside the cafe.
- Every edit sends the version read (409 on stale). Server writes use one atomic `db.batch` with guards and audit in that batch; money/points/vouchers need idempotency keys. Never delete orders or ledgers. Read the domain's integrity rules before changing a write.
- App features live in `app/features/<feature>/`; routes stay thin with a tab `title`. Cross-feature imports use public `index.ts` only; never export pages/forms, and public building blocks must not import other features. Promote code to shared roots only when a second feature or the shell needs it. Server routes are thin; SQL lives in repositories, business rules in services; server imports use `#server`/`#shared` (same-directory `./` allowed).
- App reads use `useApiQuery`, writes `useMutation`; do not recreate request state, errors or toasts. Clear identity-bound queries, mutations, drafts and UI on session transitions; discard stale in-flight responses. Never keep user data outside managed composables. Never persist secret form drafts or expose secrets in logs.
- Prefer Nuxt, Better Auth, NuxtHub and platform facilities before custom code or dependencies. UI uses Nuxt UI defaults and semantic tokens, supports light/dark, and has English chrome; preserve translated data on updates. Compact layouts are intentional touch workflows. No hardcoded cafe name.

## Load context for the task

Classify the change **before editing** and read applicable sections below. Combine routes for mixed tasks. Detailed rules remain mandatory for their scope. Use headings/search and bounded reads; follow more links only to resolve a dependency or uncertainty, never recursively read the documentation tree.

| Task | Read |
|---|---|
| UI, including copy/buttons | Relevant [UI foundation](docs/reference/ui.md) sections and [UI review checklist](docs/reference/ui-review-checklist.md); composition changes also need [page patterns](docs/reference/page-patterns.md) |
| Responsive layout/shell | [Responsive layout](docs/reference/responsive-layout.md), relevant page pattern and [app shell](docs/guides/app-shell.md) section |
| Forms/validation | [Forms](docs/reference/forms.md), UI §17, [CRUD form rules](docs/guides/crud.md) and relevant [mutations](docs/reference/mutations.md) sections |
| Queries/CRUD/API mutations | [Data fetching](docs/reference/data-fetching.md), [mutations](docs/reference/mutations.md), [errors](docs/reference/errors.md), applicable CRUD sections |
| App feature boundaries/shared APIs | [App architecture](docs/guides/app-architecture.md); find the API in the [reference index](docs/reference/README.md) or [catalog](docs/guides/project-map.md#shared-building-blocks-root-auto-imported) |
| Server service/route | [Server index](docs/server/README.md), [architecture](docs/server/architecture.md), [security route checklist](docs/server/security.md#checklist-for-every-route), affected [data-model](docs/server/data-model.md) domain |
| Authentication/permissions/tenancy | [Security](docs/server/security.md), [auth](docs/reference/auth.md), shell session rules; [multi-tenant plan](docs/plans/multi-tenant.md) for boundary changes |
| Database/migrations/payments | Data-model domain, architecture write rules, [operations migrations](docs/server/operations.md#migrations), security permissions and domain plan |
| Testing/deployment | [Development checks/tests](docs/guides/development.md); deployment also needs operations and [release check](docs/plans/release-check.md) |
| New feature/new screens | [Feature standard](docs/feature-standard.md), domain plan, applicable routes above. Preserve its owner mockup/approval workflow for new screens unless already waived by the owner |
| Resume work | [Current-state navigation](docs/current-state.md), then relevant progress phase, open question and plan |
| Investigate/change old pattern | Search [decision index](docs/decision-index.md), read matching decision and follow-ups before changing it |
| Documentation only | [Documentation index](docs/README.md) and affected sections; check links, imports, preservation and scope |

## Verification and completion

Use pnpm. Before a PR run `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` and changed feature e2e files. Shared/app-wide code changes also run full `pnpm test:e2e` locally. New guards (permissions, locks, money, idempotency, versions) must be checked by removing the guard and seeing the test fail. Commands and evidence labels: [development guide](docs/guides/development.md). Report blocked checks and actual evidence; browser mocks do not prove real-server behavior.

Update [progress](docs/progress.md) for work/status/evidence and the compact summary when active work changes; add/amend a [decision](docs/decisions.md) for architecture or a step and refresh its index. Update owning guides/references for changed conventions or shared APIs (examples must compile); record edge cases and their tests there, test pitfalls under progress's "How to verify". Admin screen changes also update the assistant's matching help page. Root instructions hold universal rules and routing only.

Work one step per branch/PR, use descriptive commits, then stop for review. Merge only with green PR checks; update the branch if main moved since checks. Failed staging deploys or red manual main runs are fixed before new work. Main deploys to staging; production is manual. Do not automatically merge. Histories are on demand and must not become startup imports.
