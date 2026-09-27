# Progress

_Last updated: 2026-09-27 (step 3.5a: menu items)._ Update this file whenever you finish or start work (see AGENTS.md → "Resuming work").

## Verification levels

Every "done" item states how it was checked. Keep using these labels:

- **unit**: covered by Vitest (`pnpm test`)
- **browser-mock**: exercised in a real browser (headless Chrome) against a mocked API (see "How to verify" below)
- **server**: covered by the `server` Vitest project (services against SQLite built from the real migrations)
- **real-server**: exercised against `pnpm dev` (real routes, Better Auth, local SQLite and blob), by script or in headless Chrome
- **real-API** (historical): exercised against the former Spring `dev-api.nukcafe.co`
- **unverified**: written but not exercised

## Current state

**Admin on our own API (2026-09-26):** the admin UI (auth, categories, schedules, menu items) now runs on our API (`/api/v1`, D40–D42); every `~/generated/api` / `unwrap` reference is gone. `pnpm typecheck` and `pnpm build` pass again for the first time since D39.

| Part | What exists | Verified |
|---|---|---|
| Schema + migration | `server/db/schema/` (media_assets, menu_categories, menu_schedules, menu_products, product_variant_groups/options, product_schedules), migration `0001_identity_and_menu` | server (every test builds the DB from the migrations); real-server (applied on `pnpm dev`) |
| Identity (steps 1.2–1.7) | Better Auth with the `admin` + `organization` plugins, roles per D45, `requirePermission` / `requireBranchPermission` / `requireCustomer`, `GET /api/admin/me`, staff management, forced password change, email verification and reset, customer profiles, seed task | server (10 tests incl. a bootstrap race); real-server (sign-up → not staff → bootstrap → admin → sign-out; cross-origin write refused) |
| Categories API | list, create, PATCH, delete, order; two levels; version checks | server (13 tests incl. a race and a stale reorder); real-server |
| Schedules API | paginated list (search/status/day), options, detail, create, PATCH, delete; local wall time in the cafe zone | server (8 tests); real-server |
| Menu items API | paginated list, whole menu, detail, create, PATCH (variants by stable id, schedules, image), delete | server (11 tests incl. a race; the race test fails with the guard removed); real-server |
| Media | upload to blob (magic-byte check, ≤ 5 MB), public serving, attach/release | server (type sniffing, attach/release); real-server (upload → PNG served) |
| Admin UI | `apiFetch`, `ApiError` for the new format, `useAuth` on Better Auth, all three features ported | unit (113); browser-mock (e2e, 115 tests); real-server (headless Chrome: login, create category/schedule/menu item with image, variants and schedule, edit, logout) |

**Found by the browser tests and fixed:** `useAuth` kept the staff session in `useState('auth:user')`, the key `@nuxtjs/better-auth` uses for its own session. Its refetch on tab focus overwrote the staff session (and would have put a Better Auth user where a staff session belongs). Keys are now `staff-session:*`; regression test in `auth.test.ts` (checked to fail with the old key).

**Greenfield product blueprint (2026-09-26):** [system-blueprint.md](plans/system-blueprint.md) starts from customer, staff, and manager journeys. Confirmed launch scope: customer website, pickup and dine-in with table QR, USD, one branch, email/password accounts with no guest ordering, pay at counter before preparation, points earned at 1 per USD after completion and exchanged for vouchers, and staff-issued vouchers; native app, delivery, and online payment are outside that scope. Product policy questions remain open in the blueprint.

**Not built yet:** no Cloudflare deployment, D1/R2 bindings or CI migration step; no customer or cashier screens; no admin reset of a staff member's password; no cleanup of temporary uploads; no public menu API.

The Foundation table below is the app's shared UI behavior; it stays valid through the server rebuild.

### Foundation

| Area | Status | Verified |
|---|---|---|
| Nuxt 4 SPA + Nuxt UI dashboard shell, sidebar navigation, error page | done | browser-mock |
| API client `apiFetch`: `/api` base, 30 s timeout, no hidden retries, `ApiError` for every failure, 401 / 403 NOT_ADMIN end the session, 403 PASSWORD_CHANGE_REQUIRED opens the change-password page, responses from a previous identity discarded (D40) | done | unit (`api-fetch.test.ts`), e2e |
| Record locks across mutations; prototype-safe mutation keys (D28) | done | unit (incl. reactivity); e2e bulk delete during a pending edit |
| Session-transition contract: generation, stale-response discard, boundary cleanup (D29) | done | unit; e2e `session.test.ts` (each mechanism checked by disabling it) |
| `useApiQuery` `watch` cancels instead of queueing (D30) | done | e2e (fails without the fix) |
| `CategorySelect`: error + Retry, current value always visible, inactive not offered while Q9 is open; no blur validation in the Category form (D31) | done | e2e `pickers.test.ts` |
| Strict e2e harness (unmocked requests fail) + `deferred`, `paginatedHandler`, `failures` | done | proven with a throwaway failing test |
| Error handling: `ApiError` classification (our error body and Better Auth's), user-safe messages, `ApiErrorAlert`, `useNotify`, safety-net plugin | done | unit, browser-mock, real-server (error shapes) |
| Auth: email login (Better Auth), staff session check, global guard, logout, redirect on session loss | done | browser-mock, real-server (login, logout, protected-page redirect) |
| Icons bundled into the client build, no runtime Iconify API calls (D18) | done | build output (all app icons present in the bundle); not yet checked in a browser |
| Unsaved-changes guard: modal close (X/Esc/outside/Cancel), route changes incl. back/forward, logout, tab close/reload; one dialog for many forms (D19) | done | unit (`form-value`), e2e (`unsaved-changes`, `session`): failed save, forward, expiry and other-tab logout with a dirty form. Not browser-tested: voluntary logout with a dirty form (a modal covers the menu; no page form exists) |
| Browser tab titles per page (D23) | done | e2e |
| List pages: filters/page in the URL, search as you type, empty states (D21) | done | unit (`query`), e2e (`list-page`) |
| Data freshness: cross-tab invalidation, refetch stale (≥ 5s) data on return, refetch on reconnect, offline banner (D22) | done | e2e (`freshness`: two tabs in one context, faked visibility and clock, offline). The two-tab test was checked to fail with the broadcast disabled |
| Login: password hidden with show/hide toggle | done | e2e |
| E2E harness: one build, `mockApi` for our API and Better Auth, typed fixtures, 115 tests (D20, D42) | done | runs in `pnpm test` and CI |
| Login/logout across tabs (D26) | done | e2e (checked to fail with the broadcast disabled) |
| Open-redirect fix: `?redirect=//other-site` after login now goes to `/` (D26) | done | e2e |
| Keyboard shortcuts: `/`, `N`, Ctrl/⌘+Enter, `?` list (D25) | done | e2e (the behind-a-dialog guard was checked by removing it) |
| CI: GitHub Actions: lint, typecheck, audit and unit in one job, e2e in three parallel shards, then the staging deploy (D24, D54, D56) | done | runs on every PR and push to `main`; about 3.5 min (was 7) |
| Feature architecture + ESLint boundary rules | done | lint (violations verified to be reported) |
| CRUD state: `useApiQuery`, `useMutation` (per-item concurrency, shared state, batch, Stop, Retry failed), `useTableSelection`, `BulkActionsBar`, leave-page guard | done | unit (engine), browser-mock (all async scenarios) |
| **List UI refresh (2026-09-26, [plan](plans/list-ui-refresh.md), D37):** `StatusTabs` + `useStatusCounts`, floating `BulkActionsBar`, `ListSkeleton`, selection helpers for cards/trees | done | e2e on all three pages; light + dark screenshots |

### Features

The admin screens that exist today. They run on the **pre-standard** `/api/v1` routes ([reference/api.md](reference/api.md)) and are rebuilt per the server standard in steps 1.7 and 3.8–4.4.

| Feature | Routes (`/api/v1/admin/...`) | Status |
|---|---|---|
| auth | Better Auth `/api/auth/sign-in/email`, `sign-out`, `change-password`; `/api/admin/me` | **done** (D52): admins only, forced password change, change password from the user menu. server + unit + browser-mock (`auth`, `password`) + real-server |
| staff | `/api/admin/staff`, `/api/admin/branches/options` | **done** (D49, D52): list with search and role/branch filters, add (temporary password shown once), change access, disable. server + unit + browser-mock (`staff.test.ts`) + real-server |
| categories (menu) | `categories`, `categories/{id}`, `categories/order` | **done, reference feature**: tree of mains and subs, search + status tabs, create/edit, add sub-category, delete, batch delete, drag-to-sort per level, version checks. server + unit + browser-mock (`categories.test.ts`) + real-server |
| schedules (menu) | `schedules`, `schedules/options`, `schedules/{id}` | **done**: list (search, status, day), create, edit (menu items shown read-only, never sent), delete + bulk delete for schedules not in use; times as cafe time (D41). server + unit + browser-mock (`schedules.test.ts`) + real-server |
| products = "Menu items" | `products`, `products/all`, `products/{id}`, `media` | **done**: list/grid/grouped menu, filters, create/edit (image upload, replace, **remove**, category, price in cents, schedules, variant editor), delete + bulk delete. server + unit + browser-mock (`products.test.ts`) + real-server. **Not built:** sort order within a category, price-range filter |

Everything else (branches and tables, the customer website, orders, payments, loyalty, vouchers, reports) is not started; it is built in the numbered steps below. Community posts, carbon and banners from the old API have no product design and are out of scope until the owner asks for them.

## Next steps (recommended order)

The server is being rebuilt to the **server standard** ([docs/server/](server/README.md), D43, written 2026-09-27; no code follows it yet). Each phase gets a short plan before coding and ends with passing tests and an update here.

**How we work:** one step at a time. For each step the agent writes a short plan (for steps marked ✋, it asks first), builds it on its own branch, runs `pnpm lint`, `pnpm typecheck` and `pnpm test`, updates the docs, then **stops for review**. The next step starts only after approval. ✋ marks a step that needs a decision from the owner first (question numbers link to the Open questions table). ✅ marks a step that is done.

### Phase 0: groundwork

| # | Step | Done when |
|---|---|---|
| 0.1 ✅ | **Clean stale docs:** fold the few platform facts from `plans/fullstack-backend.md` into `docs/server/` and delete it; replace the system blueprint's data map, API shape and build order sections with links; mark `reference/api.md` as "current code, being replaced" | No doc tells an agent to build the old design |
| 0.2 ✅ | **Auth spike** (throwaway branch, ½ day): `admin` + `organization` plugins with access control | Report: plugin tables are generated into migrations; `userHasPermission` / `hasPermission` work from a Nitro route; `createUser` can set `emailVerified` and `mustChangePassword`. Standard amended if anything differs |

### Phase 1: platform foundation

| # | Step | Done when |
|---|---|---|
| 1.1 ✅ | **Server skeleton:** `server/features/` layers; utils (`apiError` with request id, `readValidBody` / params / query, db + batch guards, UUID v7); Nitro error handler; request-id middleware; server test harness moved to features | Tests for the utils; existing screens still work |
| 1.2 ✅ | **Identity config** (roles per D45): Better Auth `admin` + `organization` plugins, roles and permission statements, `haveIBeenPwned`, auth rate-limit rules, trusted origins; **fresh migrations** (old menu tables kept until 3.8) | Migrations generated and reviewed; a server test per role grant |
| 1.3 ✅ | **Access helpers:** `requirePermission`, `requireBranchPermission`, route rules per surface, origin check on trusted origins (done in 1.2, D47), security headers | Tests: 401 / 403 / 404 for wrong surface, role and branch |
| 1.4 ✅ | **Seed and staff:** seed task (first admin, demo branch); `/api/admin/staff` (list, create with temporary password, change role, disable); `mustChangePassword` enforcement and change-password flow; audit on each | Server tests including "disabled staff lose their sessions" |
| 1.5 ✅ | **Platform tables:** `audit_events` (moved), `idempotency_keys`, `outbox_messages` + delivery task | Replay and retry tests |
| 1.6 ✅ | **Customer accounts:** Resend mail sender (console locally), email verification, password reset, sign-up hook creating the customer profile (member code) | Unverified accounts are refused on shop writes |
| 1.7 ✅ | **Admin app on the new identity:** `useAuth` reads roles from Better Auth, change-password screen, **Staff** admin page; remove `staff_profiles`, bootstrap route, `requireStaff`; the old menu routes use `requirePermission` until replaced | e2e: login, forced password change, staff page; the old menu screens still work |

### Phase 2: staging

| # | Step | Done when |
|---|---|---|
| 2.1 ✅ | **Cloudflare staging:** Worker, D1, R2, KV, secrets, domain (Q4: the domain) | The app runs on staging |
| 2.2 ✅ | **CI deploy:** checks → migrate staging D1 → deploy → smoke check; `pnpm audit`; WAF rate limits; Time Travel checked | A merge to `main` deploys itself; batch guards verified on D1 |

### Phase 3: menu API

| # | Step | Done when |
|---|---|---|
| 3.1 ✅ | **Categories:** two-level tree, "items only in leaves", order per parent, archive | Server tests for every rule |
| 3.2 ✅ | **Media:** upload (ensureBlob + magic bytes), attach/release, temporary cleanup task | Tests; cleanup task idempotent |
| 3.3 ✅ | **Options library:** option sets and values, archive rules | Tests |
| 3.4 ✅ | **Add-ons library:** modifier groups, modifiers with default prices, "used by N items" | Tests |
| 3.5a ✅ | **Menu items:** item CRUD, option sets (max 2) with the version price grid, draft / active / archived, order within a category, the item side of "items only in leaves" | Tests incl. grid regeneration and version conflicts |
| 3.5b | **Add-ons on items:** add-on groups on an item with per-item rule and price overrides; "used by N items" for add-on groups | Tests |
| 3.6 | **Sold-out per branch:** `branch_item_states` + counter route | Tests |
| 3.7 | **Availability rules** (overnight windows; no rule = always, several = any; D45) | Tests of the window rules |
| 3.8 | **Public menu API** (cached, purged on writes); **remove the old menu tables and `/api/v1` routes** | Public menu shows only active, available, in-stock versions |

### Phase 4: admin menu screens

| # | Step | Done when |
|---|---|---|
| 4.1 | **Categories** page (tree, sub-categories, drag order) | e2e |
| 4.2 | **Options** page | e2e |
| 4.3 | **Add-ons** page | e2e |
| 4.4 | **Menu items** list and form (category picker, option sets, price grid, add-ons, image) | e2e |

### Phase 5: branches and the customer website

| # | Step | Done when |
|---|---|---|
| 5.1 | **Branch settings + dining tables:** timezone, address, hours; tables with hashed QR tokens and rotation; admin pages | Tests: unknown or archived tokens rejected |
| 5.2 | **Customer site shell:** SSR public pages, SPA admin/counter (D45), layout, sign-up / sign-in / verify / reset pages | e2e of the account journeys |
| 5.3 | **Menu browsing:** categories as tabs, sub-categories as sections, item page with options and add-ons, QR table context | e2e |

### Phase 6: orders and counter payment

| # | Step | Done when |
|---|---|---|
| 6.1 | **Pricing and quote** (no tax or service charge; one voucher per order; D45) | Totals match written examples |
| 6.2 | **Checkout** (only while open, ASAP pickup; D45): idempotent order placement, snapshots, pickup numbers per business day; cart and checkout on the site | Replay and double-submit tests |
| 6.3 ✋ | **Counter queue and actions:** preparing (on payment) / ready / complete / cancel (payment starts preparation, D45; Q36: cancelling a paid order) + counter screen | Concurrent-action tests |
| 6.4 | **Counter payment** (cash USD, cash KHR at the admin-set rate, KHQR; D45) before preparation | One payment per order under retries |
| 6.5 | **Order tracking** for the customer | e2e |
| 6.6 | **Unpaid-order expiry** task (30 minutes; D45) | Task test |

### Phase 7: loyalty and vouchers

| # | Step | Done when |
|---|---|---|
| 7.1 | **Points ledger + earn on completion** (paid amount after discounts, rounded down; D45) | Earned once under retries; balance reconciles |
| 7.2 | **Voucher templates** ($ off or free item, 30 days, one per order; D45) | Tests |
| 7.3 | **Exchange points for a voucher** (by the customer on the website; D45) | No double spend under races |
| 7.4 | **Staff-issued vouchers** with reason and audit | Tests |
| 7.5 | **Redemption at the counter** (lookup, redeem; not on one's own voucher) | Last-use race test |
| 7.6 | **Reversals on cancel / refund** (reverse points, restore an unexpired voucher; D45) | Ledger reconciles |

### Phase 8: launch

| # | Step | Done when |
|---|---|---|
| 8.1 | **Reports and audit viewer:** sales per day and per item, points and vouchers, staff activity (D45) | Report definitions written into the plan |
| 8.2 ✋ | **Production** (Q4, Q24): environment, domain, email domain (SPF/DKIM), alerts, restore drill, release test scenarios (blueprint §8) | Launch checklist signed off |

**What happens to the current server code** (nothing is in production, so no data migration):
- **Replaced in phase 1 (by step 1.7):** `staff_profiles`, the bootstrap route and `NUXT_BOOTSTRAP_TOKEN`, `ROLE_PERMISSIONS`, `requireStaff`, the `/api/v1` routes, the current `server/features/` services (split into repository + service layers), migration `0001_identity_and_menu` (local databases are recreated).
- **Replaced in step 3.8:** the D41 menu tables (categories with parents, schedules, products, variant groups).
- **Kept and moved into the new layout:** `apiError`, the validation helpers, the batch guards, the origin check, audit events, media handling, the `server` test harness; in the app, `apiFetch` / `ApiError` (pointed at the new routes).
- **Admin screens:** Categories, Schedules and Menu items keep working against the old routes until step 3.8 removes them, then return in phase 4.

## Open questions / waiting on others

Business decisions the build still needs, with the step each blocks. All are for the **project owner**; nothing is built on a guess. Answered questions move to [decisions.md](decisions.md) (the 2026-09-27 round is D45) and out of this table.

| # | Question | Blocks | Suggested default |
|---|---|---|---|
| Q4 | Staging and production domains, and the email sending domain | 2.1, 8.2 | |
| Q24 | Acceptable data loss and downtime (RPO/RTO), who receives alerts and when, data retention and erasure periods | 8.2 | |
| Q36 | Can staff cancel an order that is **already paid** (money handed back at the counter), or does that always need an admin refund? | 6.3 | Staff and managers may cancel a paid order before it's ready, recording the cash/KHQR returned; after that, admin refund only |

## Known limitations

- Staging runs on Cloudflare (step 2.1): D1 migrations, both batch guards (stale version, last admin) under simultaneous requests, cron triggers and the outbox were verified there. R2 uploads and serving were verified on staging after step 3.2 (upload, byte-identical read-back, object present in the bucket), and the hourly `media:purge-temporary` deleted a backdated upload there (row and object). The CI deploy was checked step by step by hand (same commands, same smoke check); **its first run in GitHub is the merge of the phase 1–2 pull request**. Staging mail uses Resend's test sender, which delivers only to the Resend account's own address, until the sending domain exists (Q4). WAF rate limits need a custom domain (a `workers.dev` address isn't a zone we control); until then only Better Auth's own limits apply.
- Only one role (`admin`) and no staff management: other staff can't be added yet (Q6).
- Uploads: abandoned or replaced images stay as `temporary` assets until a cleanup job exists. No sort-order UI for menu items.
- Schedules: overnight ranges are refused (Q14); schedules in use can't be deleted (Q16). The time zone of new schedules comes from `NUXT_PUBLIC_CAFE_TIME_ZONE` (default `Asia/Phnom_Penh`).
- A 409 (someone else saved first) shows the server's message and keeps the form open; the user must reload the record (close and reopen) to get the new version. No merge UI.
- Inactive records can still be chosen by the API as parents, categories or schedules; only the pickers avoid offering them (Q9).
- Unsaved-changes comparison treats `1` and `'1'` as different and array order as meaningful (see docs/reference/forms.md).
- List filters in the URL support strings and numbers only, and one URL-synced list per page (`syncUrl: false` for others). See docs/reference/data-fetching.md.
- Data freshness: another device's change shows up only when the user returns to the tab or navigates (no push from the backend). No per-query opt-out yet. No polling (orders will likely need it per screen: D22).

## How to verify

- Run `pnpm lint`, `pnpm typecheck` and `pnpm test` before finishing. All pass as of 2026-09-27 (unit 125, server 286, e2e 130).
- **server:** `pnpm vitest run --project server`. Each test gets a fresh in-memory database from the checked-in migrations. To check that a concurrency test guards something, remove the guard (`requireOneChange`) and see it fail.
- **real-server (a first admin locally):** start `NUXT_SEED_ADMIN_EMAIL=you@example.com pnpm dev`, run `curl http://localhost:3000/_nitro/tasks/db:seed` (prints a temporary password), sign in at `/login` and choose your own password. More staff: the Staff page. `.data/db/sqlite.db` is the local database (stop the dev server before touching it: Windows locks it).
  - Pitfall: `@nuxtjs/better-auth` owns the `useState` keys `auth:*`. Don't name app state `auth:…`.
  - Pitfall: sign-up checks the password against Have I Been Pwned (network needed): `password123` is refused with `PASSWORD_COMPROMISED`. Use a long random one.
  - Pitfall: in Drizzle, ``exists(sql`select …`)`` renders the subquery without parentheses; write ``sql`(select …)` `` inside it, or SQLite reports `near "select": syntax error`.
  - Pitfall: drizzle's **D1** driver can't batch a raw ``db.run(sql`…`)`` that has bound parameters (it crashes reading `stmt.bind`); libsql can, so local tests never show it. Batch statements must be query-builder statements; the guards are `select`s (D53, test in `server/tests/batch.test.ts` with a stand-in D1 client).
  - Pitfall: `nuxt build --envName staging` doesn't apply `$production`; repeat what deployed builds need in `$env.<name>`.
  - Pitfall: a `compiled` key under `nitro.hooks` in nuxt.config **replaces** the Cloudflare preset's own `compiled` hook (which writes `wrangler.json`); add hooks from `nitro:init` instead.
  - Pitfall: Wrangler needs a browser login once per machine (`! npx wrangler login` in Claude Code); commands then run with `CI=1` to skip prompts.
  - Pitfall: `server/auth.config.ts` must not import a feature's `index.ts` (or anything reaching `hub:db` / `hub:db:schema`): the module loads it at build time and typecheck fails with NUXT_AUTH_CONFIG_LOAD_FAILED (D48).
  - **A table rename after step 2.1** (drizzle-kit would prompt): write the migration by hand. Generate a full snapshot into a temp folder (`npx drizzle-kit generate --dialect sqlite --casing snake_case --schema .nuxt/hub/db/schema.mjs --out <tmp>`), write `000N_<name>.sql` (`ALTER TABLE … RENAME TO …`, index renames, the new `CREATE`s copied from the temp SQL), copy the temp snapshot to `meta/000N_snapshot.json` with `prevId` = the previous snapshot's `id`, add the journal entry, then **`pnpm nuxt db generate` must say "No schema changes"**. Keep comments in the same statement as SQL (a comment-only statement between breakpoints can fail). Done for `0003_menu_categories` (D55).
  - Pitfall: drizzle-kit **splits an index expression at its commas** (`coalesce(parent_id, '')` became broken SQL, in the migration and the snapshot). Write index expressions without commas (D55 uses two partial indexes).
  - Pitfall: schema changes add a migration (`pnpm nuxt db generate`, then rename it and its journal tag). Only a change `drizzle-kit` would ask about interactively (a rename) was handled by **regenerating** `0000_initial` while nothing is deployed (steps 1.2 and 1.5, D50); after such a regeneration a local `.data/db` must be deleted (dev server stopped). From step 2.1 on, never regenerate.
  - Pitfall: SQLite's `unixepoch('subsecond')` default can round 1 ms ahead of a JavaScript `Date` taken right after the insert, so "due now" comparisons against a row created a moment ago can miss. In tests, pass an explicit later `now` (the outbox tests do).
  - Account emails locally: without `NUXT_MAIL_RESEND_API_KEY` the dev server prints them (with the link) within a minute; `curl http://localhost:3000/_nitro/tasks/platform:deliver-outbox` sends at once.
  - Pitfall: `drizzle-kit generate` asks interactively when a column looks renamed, which fails in a non-interactive shell. Another reason to regenerate while nothing is deployed; after 2.1, write the rename as its own migration.
  - Pitfall: paths handed to NuxtHub's `hub:db:schema:extend` go into a generated import: use forward slashes on Windows ("Unterminated string constant" otherwise), like the error handler in D46.
  - Pitfall: a race test must make the race happen. Two `Promise.all` calls against in-memory SQLite can still run one after the other; hold both at the critical point (`meetingPoint` in `platform.service.test.ts`) and remove the guard to check the test fails.
  - Pitfall: a bash heredoc containing an apostrophe inside a quoted `'EOF'` block failed in this environment's shell wrapper ("unexpected EOF"). Write edit scripts with the editor instead.
  - Pitfall: to smoke-test a production build, run `node .output/server/index.mjs` with the `.env` variables **and** `NUXT_PUBLIC_SITE_URL` set; without it every auth-touching route answers 500 (logged as "siteUrl required in production").
  - Pitfall: backticks inside a `node -e "…"` script in bash are command substitution: they vanish silently. Use a script file or the editor for text containing backticks.
  - Pitfall: several repo files use CRLF line endings; a Node text replacement with LF anchors silently matches nothing. Normalize (`replace(/\r\n/g, '\n')`) before replacing, and check the replacement happened.
- **e2e (preferred):** `pnpm vitest run --project e2e`. Add scenarios to `test/e2e/` instead of throwaway scripts. Pitfalls met so far:
  - `expect.poll` defaults to a 1 s timeout; a cold page (session → refresh → redirect) can take longer under full-suite load. The e2e project sets 5 s (`vitest.config.ts`). Flaky "expected /categories to be /login" failures came from this.
  - **Escape also dismisses Reka toasts.** A test that presses Escape to close a modal may silently close the toast it later checks. Close modals with their button when toasts matter.
  - `UIcon` renders `aria-hidden`, so `getByLabel('Working…')` doesn't find the busy spinner. Use `locator('[aria-label="Working…"]')`.
  - `gotoViaSidebar` returns after the clicks, not after the last navigation. Wait for the path before testing back/forward.
  - Vitest hides `console.log` from passing e2e tests. To inspect a value while debugging, assert it against a sentinel and read the failure message (`expected +0 to be 99`: mind the `+`).
  - To check that a test guards a behavior, disable the behavior (move a plugin away, drop an option) and confirm the test fails. Several tests written in this project passed vacuously at first.
  - `UForm` debounces input validation (~300 ms). After `fill()` on a field showing an error, wait for the error to disappear before clicking anything below it, or the layout shift makes the click miss (`check()` then reports "did not change its state").
  - A modal's header X and a footer button can both be named "Close". Scope to `[data-slot="footer"]`.
  - `UInputTime` / `UInputDate` render segments (`role="spinbutton"`), not an `<input>`: `fill()` and `getByLabel(<field label>)` don't work (the label targets a hidden input). Give the component an `aria-label`, find it with `getByRole('group', { name })`, click the first segment and type digits (`'0830'`); typing replaces an existing value. See `typeTime` in `test/e2e/schedules.test.ts`.
  - `BulkActionsBar` fades out (100 ms): after an action that clears the selection, poll for "N selected" to disappear instead of counting at once.
  - The Categories tree and `CategorySelect` both call `GET /staff/categories/all` (the picker with `type=MAIN`): a mock must answer by query, and a "list loads" count must skip `type` requests (see `freshness.test.ts`, `pickers.test.ts`).
  - Status-tab counts call the list endpoint with `size=1`: exclude those when counting list requests (`isCount` in `list-page.test.ts`).
  - Row buttons are named after the item ("Actions for Tea", "Select Tea"), so a user-menu button like "alice" needs `{ exact: true }` once an item contains that name.
  - `page.reload()` has no `waitUntil: 'hydration'`; use `page.goto(page.url(), { waitUntil: 'hydration' })`.
  - Under load, a full `pnpm test` once hit a wave of 30 s timeouts in unrelated files right after another e2e run; the rerun passed. Rerun before chasing such a failure. Seen again in step 1.3: the two-tab tests (`auth`, `freshness`, `session`) time out only when `pnpm test` runs every project at once; alone, and in `pnpm test:e2e`, they pass.
  - `getByLabel` matches **substrings**: `'Name'` also matches "Name of group 1", and "Option 2 of Milk" matched "Extra price of option 2 of Milk". Use `{ exact: true }`, or labels that can't contain each other.
  - SortableJS drag and drop works with Playwright's `locator.dragTo(target)` on the drag handle.
  - `UInputNumber` is `role="spinbutton"` (not a textbox); `fill('4.2')` works and it shows `$4.20` after blur.
  - File uploads: click the button inside `Promise.all([page.waitForEvent('filechooser'), click])`, then `chooser.setFiles({ name, mimeType, buffer })`. `mockApi` hands non-JSON bodies (multipart) to handlers as raw text.
  - **PowerShell 5.1 `Get-Content` reads UTF-8 files without a BOM as ANSI**, so a `Get-Content | Set-Content` edit garbles `…` and non-Latin text (tests then fail on text that "should" match). Edit with the editor or Node, never PowerShell text round trips.
  - A field that validates on blur can shift the layout between mousedown and mouseup, so a Playwright click (or a user's) misses. Suspect this when a click "does nothing" but `element.click()` works.
  - Toasts: Nuxt UI renders a hidden `aria-live` copy of each toast's text, so `getByText` matches twice (strict-mode error). Use the `toast(page, title)` helper.
  - Back/forward: reach the page through the sidebar (`gotoViaSidebar`). After `page.goto`, Back leaves the SPA (full page load) instead of changing route.
  - Always `goto(..., { waitUntil: 'hydration' })`. Without it, assertions can run before the app mounts and fail only under full-suite load.
  - While our confirm dialog is on top, the form modal behind it is `aria-hidden`, so `getByRole('dialog')` doesn't find it. Check the form after answering.
  - UTable renders an extra `<tr>` in the header. Count cells, not rows.
  - The production CSP (D48) blocks images from other origins: fixture image URLs must be same-origin `/media/…` (`mockApi` serves a 1×1 PNG there). A component that drops a broken `<img>` makes a src assertion fail.
  - Two tabs of one browser (`openTabs`, closed after each test since D46): `createPage()` opens a single-page context, so create one with `(await getBrowser()).newContext()`, open both pages in it, and wait with `waitForHydration(page, url, 'hydration')` (raw pages lack the `waitUntil: 'hydration'` wrapper). Tabs in one context share `BroadcastChannel`.
  - Tab visibility: fake `document.visibilityState` + dispatch `visibilitychange`, and move time with `page.clock.install()` / `fastForward`. Offline: `page.context().setOffline(true)` (fires the `offline` event; `page.route` mocks still answer).
  - In a `node -e` one-liner inside single-quoted bash, `\d` in a regex loses its backslash. Edit test files with the editor, not shell string replacement.
- **browser-mock (ad hoc):** start `pnpm dev --port 3123`, then drive headless Chrome with `playwright-core` (`chromium.launch({ channel: 'chrome' })`) and mock the server with `page.route('http://localhost:3123/api/**', …)` (or use the real server, see real-server above). Pitfalls met so far:
  - Use the full origin in the route pattern. A bare `**/api/**` also matches the Vite module `/_nuxt/generated/api/*.ts` and breaks the app.
  - `UAlert` has no `role="alert"`. Match on text.
  - Headless Chrome doesn't show the `beforeunload` dialog. Verify the guard by dispatching a cancelable `beforeunload` event and checking `defaultPrevented`.
  - Stopping the dev-server task can leave an orphaned Nuxt process holding the port and the lock ("Another Nuxt dev server is already running"). Kill it by port (`Get-NetTCPConnection -LocalPort 3123`) before restarting.
- **real-API** (historical): the Spring dev API is no longer used.

## Environment notes

- Windows, pnpm 12. Bash (Git Bash) and PowerShell are both available. **Python is not installed.**
- `pnpm nuxt prepare` regenerates `.nuxt/`. Run it if lint or typecheck reports missing `.nuxt/*` files or new auto-imports aren't recognized.
