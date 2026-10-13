# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, and others) working in this repository. This is the **single source of truth**. `CLAUDE.md` only imports this file.

This file holds the rules that always apply. Everything task-specific is in the docs named by the index below: read the one for your task before you start.

## Task-to-doc index

| When the task is... | Read first |
|---|---|
| Building a new feature | `docs/feature-standard.md`, then the feature's plan in `docs/plans/` |
| Changing UI or visual style | `docs/reference/ui.md`, then `docs/reference/page-patterns.md` |
| Changing layout or responsiveness | `docs/reference/responsive-layout.md` |
| Before merging any UI change | `docs/reference/ui-review-checklist.md` |
| Changing server code | `docs/server/README.md`, then the page it links to for the area |
| Changing schema or data model | `docs/server/data-model.md` |
| Changing auth or security | `docs/server/security.md`, `docs/reference/auth.md` |
| Using or changing a shared API or composable | `docs/reference/README.md`, then the linked page |
| Changing forms or unsaved-change behavior | `docs/reference/forms.md` |
| Changing mutations or concurrency | `docs/reference/mutations.md` |
| Checking current status or next steps | `docs/status.md` |
| Checking why something was decided | `docs/decisions-index.md`, then the matching entry in `docs/decisions.md` (by D-number or topic; never the whole file) |
| Writing or changing app (Vue/Nuxt) code in a feature | `docs/app-conventions.md` |
| Changing app-wide behavior (tab titles, refresh on tab focus, offline, leave guards, session loss) | `docs/reference/app-behavior.md` |
| Changing an admin screen | also update its page in `server/features/assistant/help/*.md` (the help assistant's guide); the rule is Rule 7 in `docs/app-conventions.md` |
| Writing a cafe's name into a page, or showing a menu item photo | `docs/reference/README.md` → "Root shared blocks: usage rules" (`useCafe()` / `<CafeLogo>`, `<MenuItemImage>`) |
| Linking to a cafe's page | `docs/app-conventions.md` → "What this is (continued): paths, screens, reference features" (`useTenantPath()`) |
| Running checks, opening a PR, committing, or finishing a step | `docs/workflow.md` |
| Writing, running, or debugging tests | `docs/how-to-verify.md` |

## Resuming work: read first

1. **[docs/status.md](docs/status.md)**: what's done, what's next, open questions for the backend team, and how well each part has been verified. Start every session here.
2. **[docs/decisions.md](docs/decisions.md)**: why things are the way they are. Read the relevant entry **before changing** a pattern that looks odd. Most of them work around a verified backend or tooling quirk.
3. **[docs/reference/](docs/reference/README.md)**: reference for every shared app composable, util and component (`useMutation`, `useApiQuery`, `apiFetch`, `ApiError`, …) with types, options and examples. Routes and the server's error format are in docs/server/. Check it before using or changing a shared API. **[App-wide behavior](docs/reference/app-behavior.md)** (tab titles, refresh on tab focus, offline, leave guards, session loss) and **[Forms: unsaved changes](docs/reference/forms.md)** list every edge case those handle.
4. **[docs/feature-standard.md](docs/feature-standard.md)**: how every new feature is planned, built and verified (the mockup workflow for UI steps, planning template, list/form/picker behavior, definition of done). **Read it before starting a feature.**
5. **UI and responsive layout (mandatory for any UI work):** Nuxt UI is the component design system and Tailwind CSS tokens are the layout and styling language. [ui.md](docs/reference/ui.md) (visual foundation; **§17 expected behavior**: overlays, form errors, controls that save when changed, reordering, times), [responsive-layout.md](docs/reference/responsive-layout.md) (width classes, shell, navigation, page anatomy), [page-patterns.md](docs/reference/page-patterns.md) (index, settings, detail/editor, task flow, states) and [ui-review-checklist.md](docs/reference/ui-review-checklist.md) (run before merging). **Design compact layouts (<640px) intentionally as focused touch workflows; never just shrink or stack the desktop composition.** The rollout of these rules to existing pages, and the owner-decision table (never build on an open decision): [plans/ui-standardization.md](docs/plans/ui-standardization.md).
6. **[docs/server/](docs/server/README.md)**: the **server standard** (architecture, security, data model, operations). **Every server change follows it.** All server code follows it since the legacy menu was removed in step 3.8b (D71).

**Keep these documents current as part of your work:**
- Finished or started something → update `docs/status.md` (status, next steps, and what you verified and how).
- Made or changed an architectural decision → add or amend an entry in `docs/decisions.md`.
- Changed a convention, rule or shared building block → update this file.
- Added or changed a shared API (or a feature's public `index.ts`) → update its page in `docs/reference/` (examples must compile).
- Found or handled an **edge case** (a browser quirk, a backend inconsistency, a timing issue) → add it to the case table of the page it belongs to (`app-behavior.md`, `forms.md`, `data-fetching.md`, …) with how it's handled and which test covers it. Test pitfalls go in `docs/how-to-verify.md` → "How to verify".

## What this is

NUK Cafe is one Nuxt full stack app: the customer website, the admin workspace and the cashier workspace, plus our own API (Nitro) with Better Auth, NuxtHub, Drizzle, SQLite locally and D1/R2/KV on Cloudflare. Product scope: [the system blueprint](docs/plans/system-blueprint.md). **How the server is built: the [server standard](docs/server/README.md)** (routes `/api/<surface>/…`, `server/features/` with service/repository layers, Better Auth roles and branches, the data model, operations). Build order: [status.md → Next steps](docs/status.md#next-steps-recommended-order).

**Multi-tenant (D134, being built, [plan](docs/plans/multi-tenant.md)):** the app is becoming SaaS-ready: one tenant per cafe (a Better Auth organization), `tenant_id` on every tenant-owned table, the tenant in the path (`/c/<slug>/…` pages, D141; `/api/c/<slug>/…` routes, D140), `/platform` for super admins (the platform console, `app/features/platform/`, layout `platform`, on `/api/platform`, D142). **New tables and queries follow the plan's rules:** tenant-owned rows carry `tenant_id`, every query names the tenant, and a two-cafe test proves it.

## Authorization, tenant scoping and concurrency (quoted from the server standard)

_These are existing rules of [docs/server/](docs/server/README.md), quoted here so they are always loaded; the pages are the source. In the security.md quote, "Each" means each access helper (`requireTenant`, `requirePermission`, `requireBranchPermission`, `requirePlatformPermission`)._

- **security.md:** Deny by default: a route without a permission check is a bug. The `routeRules` session gate only asks for a session (401); it can't see tenants, roles, branches, `mustChangePassword` or email verification. `server/tests/admin-routes.test.ts` fails when an admin route calls no access helper.
- **security.md:** Each returns the **actor** (`{ userId, tenantId, role }`, plus `branchId` and `branchRole?` on the counter) that services receive: they scope every read and write to `actor.tenantId` and write it to the audit log.
- **architecture.md:** No route takes a tenant from a body or query.
- **security.md:** The branch id comes from the path (`readIdParam(event, 'branchId', 'The branch')`), never from a body.
- **architecture.md:** Every editable record has `version`. An edit sends the version it read; the write applies only if it still matches, otherwise **409 `VERSION_CONFLICT`** and nothing changes. The UI shows "changed by someone else, reload". Status-changing actions (ready, complete…) also check the current state in the same conditional write.

## Feature architecture

```
app/
├── features/<feature>/          # everything specific to one business area
│   ├── index.ts                 # PUBLIC API: the only file other code may import
│   ├── navigation.ts            # this feature's sidebar entry (exported via index.ts)
│   ├── components/
│   │   ├── <Feature>ListPage.vue    # private screen, rendered by a route file
│   │   ├── <Feature>FormModal.vue   # private
│   │   └── <Feature>Select.vue      # public building block (picker for other features)
│   ├── composables/
│   │   ├── use<Feature>s.ts         # private: list + mutations
│   │   └── use<Feature>Options.ts   # public: data for pickers
│   ├── schemas/<feature>-form.ts    # Valibot form schema + form<->request mapping (pure, unit-tested)
│   └── tests/*.test.ts
├── pages/                       # THIN route files: definePageMeta + render <Feature>Page
├── components/ composables/ utils/   # SHARED across features only (auto-imported)
├── layouts/ middleware/ plugins/ types/   # app shell
server/                          # our API, per docs/server/architecture.md
shared/contracts/                # API contracts: request schemas + response types, used by server and app
```

### Rules (the boundary rules are enforced by ESLint in `eslint.config.mjs`)

1. **Everything specific to one feature lives in `app/features/<feature>/`.** Only code used by two or more features, or by the app shell, goes in the root `components/`, `composables/` or `utils/`. Build it inside the feature first, and move it to the root when a second feature needs it.
2. **`index.ts` exports only building blocks:** pickers (`CategorySelect`), display components, option composables (`useCategoryOptions`), types and `navigation`. **Never export pages or forms from `index.ts`.** Otherwise features that use each other (a menu item picks categories; a category could list its items) would import each other's screens and create cycles.
3. **Cross-feature imports go through the public API only:** `import { CategorySelect } from '~/features/categories'`. Deep imports (`~/features/x/composables/...`) and relative paths that leave the feature (`../../x`) are lint errors.
4. **Public building blocks must not import other features.** This keeps the dependency graph one level deep, so no cycles can form. Screens (pages, forms) may import other features' public APIs.

_Rules 5 to 7 (relative imports, thin route files, feature folder names) are in [docs/app-conventions.md](docs/app-conventions.md)._

### Cross-feature relationships (from the API)

- An item's links to libraries (option sets, add-on groups, rules) are written **only from the item**, which sends the whole list; the library pages show "used by N items" read-only (D60, D61, D63).
- Every update names the `version` it read; a stale one is refused with 409 (D41). Forms keep the record they opened and send its version.

## CRUD state: `useApiQuery` and `useMutation`

Every read goes through **`useApiQuery`** and every create/update/delete through **`useMutation`**. Never duplicate their request state: no hand-rolled request `loading` refs, in-flight tracking, try/catch or toasts for API calls. A form may keep **its own** submission state (e.g. `saving` in `CategoryFormModal`, for its disabled inputs and unsaved-change pause). See [feature-standard.md §5](docs/feature-standard.md#form-local-vs-shared-pending-state).

_The rest of this section (reads, the `useMutation` options, form and bulk-action rules) is in [docs/app-conventions.md](docs/app-conventions.md)._

## Server

Every server change follows the [server standard](docs/server/README.md). The essentials:

- **Routes** are thin, unversioned, per surface, **under the cafe's address** (D140): `/api/c/<slug>/public`, `…/shop`, `…/counter/{branchId}`, `…/admin` (files in `server/api/c/[slug]/`); the platform's own (`/api/auth`, `/api/tables/{token}`, `/api/cafes/{slug}`, `/api/me/cafes`, `/api/health`, `/api/client-errors`, `/api/webhooks`, and the console's `/api/platform/**` behind `requirePlatformPermission`, D142) stay outside. Each cafe route acts in its **tenant** (D135): `requireTenant` / the access helpers load it from the path, the actor carries `tenantId`, and every query on tenant-owned data names it. The app calls `apiFetch('/admin/…')`; `apiPath` adds the cafe's address.
- **Features** live in `server/features/<feature>/` with fixed layers: `index.ts` (public API), `*.schema.ts`, `*.types.ts`, `*.repository.ts` (all SQL), `*.service.ts` (rules and use cases), `*.errors.ts`, `tests/`.
- **Writes:** `version` checks, one atomic `db.batch` with guards, idempotency keys for money/points/vouchers, audit in the same batch.
- **The app calls the API only through `apiFetch`**, inside `useApiQuery` / `useMutation` (`ApiError`, session handling, stale-response discard).

_The other server bullets (library first, imports, the Spring SDK) are in [docs/server/README.md](docs/server/README.md#rules-moved-from-agentsmd)._

## Auth & app shell

- `app/features/auth/` exposes `useAuth()`: sign-in, sign-out and password change through Better Auth (`/api/auth`), the admin session from `GET /api/admin/me`. Only the cafe's **owners** (`owner` in the tenant, shown as "Admin"; D52, D135) use the admin app; a customer or branch-staff account is refused at login. On a temporary password every admin page goes to `/admin/change-password` first. Its state keys are `staff-session:*`: `auth:*` belongs to `@nuxtjs/better-auth`. The shell imports it from `~/features/auth`. Staff are managed on the **Staff** page (`app/features/staff/`).
- The middleware protects **every admin page (`/admin/**`) by default**. Opt out with `definePageMeta({ public: true })` (typed in `app/types/page-meta.d.ts`). The customer site (every other path) is public and never reads the admin session: anything session-related in the shell checks `isAdminPath()` from `~/features/auth` (D93).
- **Session transitions** (login, logout, expiry, another staff member via another tab) clear the previous identity's query data, mutation outcomes, toasts, overlays and unsaved forms, and discard its in-flight responses (`plugins/session-boundary.client.ts`, `useAuth().generation`, D29). Features must not keep user data outside `useApiQuery`/`useMutation`/`useState`-based composables, or the boundary can't clear it.

_The other auth and app-shell bullets are in [docs/app-conventions.md](docs/app-conventions.md#auth--app-shell)._

## Adding a full stack feature

1. Start from the user journeys in [the system blueprint](docs/plans/system-blueprint.md) and write a plan with [docs/feature-standard.md](docs/feature-standard.md). Settle any unresolved business or permission rule first, or defer that behavior; never encode a guess.

_Steps 2 to 6 are in [docs/workflow.md](docs/workflow.md#adding-a-full-stack-feature-steps-2-to-6)._

**Checks (D83):**
- **"Remove the guard and see the test fail"** is required for new guards (locks, permissions, money, idempotency, version checks); optional elsewhere.

_The rest of the checks (commands, CI, merging, commits) are in [docs/workflow.md](docs/workflow.md)._
