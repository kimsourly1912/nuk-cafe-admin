# Progress

_Last updated: 2026-09-29 (step 6.3a, the counter on the server, D101, awaiting review; step 6.2b, Review order and the order placed, D100, merged; step 6.2a, placing an order on the server, D99, merged; step 6.1, pricing and the checkout quote, D98, merged; step 5.2, the customer's account pages, D97, and light and dark mode, D96, merged; server rendering for the customer site, D95, merged; the Sample data page, D94, merged; step 5.3a, the customer menu and the admin under `/admin`, D93, merged; step 5.1b, the Branch pages, D92, merged; step 5.1a, branch settings and dining tables on the server, D91, merged; the unsaved-changes e2e flake found and fixed; the Menu item editor route, D90, merged: step 5 of the UI standard complete; the Menu items list on the UI standard, D89, merged; the Add-ons library on the UI standard, D88, merged; Availability on the UI standard, D87, merged; Options on the UI standard, D86, merged; Categories on the UI standard, D85, merged; task-flow pages on the UI standard, D84, merged; faster check workflow, D83, merged; Add-on group page on the UI standard, D82, merged; default control sizes on phones, D81, and status-color contrast, D80, merged; Staff on the UI standard, D79, merged; UI foundations, D78, merged; responsive UI standard, D77; Availability weekly agenda, D76; Add-ons library and group page, D75; Categories and Options back on Nuxt UI defaults, D74; Options redesign, D73; Categories redesign, D72; step 3.8b done, D69–D71)._ Update this file whenever you finish or start work (see AGENTS.md → "Resuming work").

## Verification levels

Every "done" item states how it was checked. Keep using these labels:

- **unit**: covered by Vitest (`pnpm test`)
- **browser-mock**: exercised in a real browser (headless Chrome) against a mocked API (see "How to verify" below)
- **server**: covered by the `server` Vitest project (services against SQLite built from the real migrations)
- **real-server**: exercised against `pnpm dev` (real routes, Better Auth, local SQLite and blob), by script or in headless Chrome
- **real-API** (historical): exercised against the former Spring `dev-api.nukcafe.co`
- **unverified**: written but not exercised

## Current state

**Everything on the server standard (2026-09-28, step 3.8b):** every admin screen runs on `/api/admin` (D52), and the pre-standard `/api/v1` menu, its tables (dropped by migration `0011_drop_legacy_menu`) and the Schedules screen are gone (D71). History: the admin first moved off the Spring API onto our own `/api/v1` (D40–D42), then onto the server standard feature by feature (steps 1.7 and 3.8b).

| Part | What exists | Verified |
|---|---|---|
| Server | Features `identity`, `branches` (settings, weekly hours, dining tables with rebuildable QR tokens, D91), `media`, `menu` (categories, option sets, add-on groups, items with the price grid, availability rules, sold-out, the public menu), `platform` (audit, idempotency, outbox), `orders` (the checkout quote, D98; placing and reading orders, D99; the counter's queue, payment and actions, the riel rate, D101); migrations `0000`–`0015` | server (every test builds the DB from the migrations, foreign keys on and D1's parameter limit enforced); staging (step 2) |
| Admin UI (under `/admin`, D93) | Staff, Branch (settings, hours, dining tables with QR codes), Menu items, Categories, Options, Add-ons, Availability, Sample data (local and staging only, D94); auth with forced password change | unit, browser-mock (e2e), real-server (headless Chromium on `pnpm dev`, per feature below) |
| Customer site (`/`, D93) | Server-rendered (D95). The menu (sections, category tabs and tree, search, item detail, the order before checkout, closed state, sold out), a table's QR link; the customer's account (sign in, create account, verify email, reset password, the header's account menu, D97); Review order and the order placed (`/checkout`, `/orders/<id>`, D100) | unit, e2e on a seeded database (`shop-menu.test.ts`, no mocks), real-server |

**Found by the browser tests and fixed:** `useAuth` kept the staff session in `useState('auth:user')`, the key `@nuxtjs/better-auth` uses for its own session. Its refetch on tab focus overwrote the staff session (and would have put a Better Auth user where a staff session belongs). Keys are now `staff-session:*`; regression test in `auth.test.ts` (checked to fail with the old key).

**Greenfield product blueprint (2026-09-26):** [system-blueprint.md](plans/system-blueprint.md) starts from customer, staff, and manager journeys. Confirmed launch scope: customer website, pickup and dine-in with table QR, USD, one branch, email/password accounts with no guest ordering, pay at counter before preparation, points earned at 1 per USD after completion and exchanged for vouchers, and staff-issued vouchers; native app, delivery, and online payment are outside that scope. Product policy questions remain open in the blueprint.

**Responsive UI standard (2026-09-28, D77): documented and merged; Phase B step 1 (foundations, D78) merged and confirmed by the owner.** Nuxt UI is the component design system; Tailwind CSS tokens are the layout and styling language. Canonical rules in `docs/reference/ui.md`, `responsive-layout.md`, `page-patterns.md` and `ui-review-checklist.md`; the audit, the owner-decision table (all approved: 8 directions plus the Settings blueprint, compact filters beyond two, one shared bottom action bar and the Menu item editor URLs; none open) and the page-migration sequence in [plans/ui-standardization.md](plans/ui-standardization.md). Step 1 (D78): 44px compact targets configured once in `app.config.ts`, light-mode primary at the 800 shade (measured), `useLayoutContext()`, one `<BottomActionBar>`. Step 2 (D79): `/staff` is the reference resource index with a table (rows on phones). Step 3 (D82): `/add-ons/[id]` is the reference detail route (a sub-collection laid out by its column, `@container`). Step 4 (D84): `/login` and `/change-password` are the reference task flow (full screen on phones, actions at the bottom, focus to errors). Step 5 goes one page per PR: 5a Categories (D85), 5b Options (D86), 5c Availability (D87), 5d the Add-ons library (D88) 5e part 1, the Menu items list (D89), and 5e part 2, the Menu item editor route (D90), done: every page is on the standard.

**Not built yet:** no production environment (staging runs on Cloudflare, steps 2.1–2.2); no cashier screens or order tracking; no admin reset of a staff member's password; no cleanup of temporary uploads. The customer site is server-rendered (D95); the admin stays a SPA.

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
| Light and dark mode: light by default, the system ignored, `UColorModeButton` in the admin sidebar, admin sign-in, store header and account pages (D96) | done | e2e (`color-mode.test.ts`, `ui-foundations.test.ts`) |
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
| **UI foundations (2026-09-28, D78, D80, D81):** Nuxt UI's default sizes at every width (44px phone targets tried and removed, D81) with invisible hit areas for checkboxes, radios and switches, light-mode primary and status colors at AA-passing shades (primary, warning and success 800, error 700, info 600), `useLayoutContext()`, `<BottomActionBar>` (one at a time, makes room, steps aside for the keyboard) | done | unit (`bottom-bar`), e2e (`ui-foundations` 12, checked to fail without the configuration), screenshots 390/1440 px light and dark |

### Features

The admin screens that exist today, all on the server standard's `/api/admin` routes.

| Feature | Routes | Status |
|---|---|---|
| auth | Better Auth `/api/auth/sign-in/email`, `sign-out`, `change-password`; `/api/admin/me` | **done** (D52): admins only, forced password change, change password from the user menu. server + unit + browser-mock (`auth`, `password`) + real-server |
| staff | `/api/admin/staff`, `/api/admin/branches/options` | **done** (D49, D52): list with search and role/branch filters, add (temporary password shown once), change access, disable; on the UI standard (D79): rows on phones, the name opens the person, full-screen form on phones. server + unit + browser-mock (`staff.test.ts`, 13) + real-server |
| categories (menu) | **new API** `/api/admin/menu/categories` | **done, reference feature** (3.8b part 3a, D69; redesigned D72; design-system polish D74): grouped tree with connector lines, search, All/Active/Archived tabs, expand/collapse all, availability in words ("Inherits parent" for subcategories, rule times in tooltips), what each holds (subcategories or items), inline "Add subcategory" (not on categories holding items), collapsed groups remembered, search by name or description, S/R/Esc shortcuts; restore a parent with its subcategories; **Select** mode (bulk archive or restore) and **Reorder** mode (drag, keyboard, Move up/down, Save/Discard; 409 → Reload keeps the order); create/edit (full screen on phones, conflict Reload keeps the input); on the UI standard (D85): the tree lays out by its container, the name block opens the category, status next to the name. server + unit + browser-mock (`categories.test.ts` 40, `pickers.test.ts`) + real-server (headless Chromium on `pnpm dev`, screenshots at 1440/768/375/320 px) |
| availability-rules = "Availability" | **new API** `/api/admin/menu/availability-rules` | **done** (3.8b part 1, D66; weekly agenda D76): full-width agenda cards (usage, seven day badges, times grouped by days with "next day"), Manage/View and ⋮ (Archive disabled with the reason while in use, Restore), All/Active/Archived tabs with counts, search; create/edit with day toggles and presets per row, overnight notes, a weekly preview and the cafe timezone, full screen on phones; archived rules read-only with Restore; the server's overlap error shown on its row. unit (17) + browser-mock (`availability-rules.test.ts`, 16; cards laid out by their own width, D87) + real-server (headless Chromium on `pnpm dev`: create, overlap on the right row, overnight edit, archive, restore; screenshots at 1440/1024/768/390 px) |
| option-sets = "Options" | **new API** `/api/admin/menu/option-sets` | **done** (3.8b part 2a, D67; redesigned D73; design-system polish D74): cards in a 2-column grid with values as chips ("+N more"), what uses it and Edit/View, the ⋮ menu only Archive or Restore; search by set or value name with a "Matches" line; All/Active/Archived tabs; create (full screen on phones, values moved with up/down); an editor (full screen on phones) with a Saving…/Saved/Couldn't save status, read-only rows with inline Edit/Rename/Add value, archived values collapsed, a danger zone, both archive confirmations, an archived set read-only with Restore; **Reorder** mode saved 0.5 s after the last move (one request, focus kept, announced, failure restores the saved order, Reload on conflict). unit (18) + browser-mock (`option-sets.test.ts`, 23; chips by the card's width, D86) + real-server (headless Chromium on `pnpm dev`: screenshots at 1440/768/375/320 px, keyboard-only reorder) |
| modifier-groups = "Add-ons" | **new API** `/api/admin/menu/modifier-groups`; `/api/admin/menu/items?modifierGroupId=` | **done** (3.8b part 2b, D68; redesigned D75): library cards with a Required/Optional badge, the rule, add-on rows with prices and preselection, "+N more", usage and Manage/View; search by group or add-on name; All/Active/Archived tabs; create → the group's own page `/add-ons/[id]`: add-ons table (search, Add/Edit dialog, Preselected checkbox, archive/restore, bottom sheet on phones), Reorder mode with Save order, "Used by" list linking to Menu items (`?item=`, `?modifierGroupId=` filter), settings saved with Save changes (one PATCH, conflict-safe), archive/restore group, archived read-only; tabs on phones; on the UI standard (D82): rows laid out by their column, the name opens Edit, reorder actions in the bottom bar. server + unit (18) + browser-mock (`modifier-groups.test.ts`, 36; library rows by the card's width, D88) + real-server (headless Chromium on `pnpm dev`: screenshots at 1440/1024/768/390 px, keyboard reorder, Menu items filter and deep link) |
| branches = "Branch" | `/api/admin/branches/{id}`, `…/tables` (D91) | **done** (5.1b, D92, the owner's mockups): `/branches` opens the only branch (or lists them); **Settings** tab (status cards: open now, time zone, today's hours; branch information; weekly hours per day with an Open switch, up to three windows, overnight noted, Copy Monday to weekdays / Saturday to weekend; one draft and one Save changes, navbar from `lg`, bottom bar below; 409 → Reload keeps the input; the server's overlap error on its window; closed-every-day warning) and **Dining tables** tab (search, All/Active/Archived with counts, cards with QR thumbnails, View QR with link, Download SVG/PNG, New QR asks then shows the new code, add/edit with area, archive/restore). unit (`branch-form.test.ts` 6) + browser-mock (`branches.test.ts`, 16) + real-server (headless Chromium on `pnpm dev`: sign in, save hours and details, add a table, its QR link resolves publicly, New QR: old link 404, new 200; screenshots at 1440 light/dark and 390) |
| menu = the customer menu | `/api/public/branches`, `/api/public/menu`, `/api/public/tables/{token}` | **done** (5.3a, D93, the owner's mockups): the home page `/`; a section per main category and a sub-section per sub-category; sticky header (branch and open status, search, Pickup or the QR table); flat tabs + "All categories" tree (popover, a sheet on phones) driven by one scroll spy; cards with a full-width "Add to order" that becomes a stepper (or "2 in order · Add another" for items with choices), rows with "Add" on phones; the item detail (versions, add-on limits, "Choose Milk" before the total; dialog, sheet on phones); search in the same cards with highlights; the order panel from `lg`, a bottom bar and sheet below (kept per branch in this browser, read against the current menu); closed banner with the next opening; sold out marked; `/table/<token>` sets the table for the tab. unit (`menu.test.ts` 15) + server + browser-mock (`shop-menu.test.ts` 15) + real-server (headless Chromium on `pnpm dev`). Server-rendered since D95 (e2e on a seeded database, hydration checked). **Not built:** order tracking (6.5) |
| account = the customer's account | Better Auth `/api/auth/*` (sign-in, sign-up, sign-out, verification, reset), `/api/shop/me` | **done** (5.2, D97, the owner's mockups): `/sign-in`, `/sign-up`, `/verify-email` (check your email, resend with a 60 s wait), `/email-verified` (the link's landing: verified, or "doesn't work anymore" with a new link), `/forgot-password` (the same answer with or without an account), `/reset-password` (token out of the URL, one field with a show button, then sign-in says the password changed); return to the page the person came from (`?redirect=`, only customer-site pages); the store header's account button (Sign in, or the initials: name, email, verified badge, member code with Copy, Sign out; read in the browser only) and the unverified banner. unit (`account.test.ts` 11) + e2e on the seeded database (`shop-account.test.ts` 13; real verification and reset links from the outbox; sign-up and saving a password mocked, they ask Have I Been Pwned) + real-server. **Not built:** profile editing, deleting an account |
| orders = the customer's orders | `/api/public/checkout/quote`, `/api/shop/orders`, `/api/shop/orders/{id}` (D98, D99) | **done** (6.2b, D100, the owner's mockups): `/checkout` Review order (pickup or the QR table with Switch to pickup; quantity, Remove and a note per line; the summary beside the lines from `lg`, a bottom bar below; the sign-in and verify gates, a dialog or a bottom sheet; prices changed underneath shown struck through with the new total on the button; closed and last orders; Try again with the same key); `/orders/<id>` (the 3-digit number, Waiting for payment, what to do next, pay by, the lines). Both browser-only. unit (`checkout.test.ts` 7, `order.test.ts` 3) + e2e on the seeded database (`shop-checkout.test.ts` 6, no mocks) + screenshots 1440/390 light and dark. **Not built:** order tracking and the customer's Cancel (6.5), a list of past orders |
| sample-data = "Sample data" | `/api/admin/sample-data` (+ `/menu`, `/branch`, `/reset`; 404 unless `NUXT_PUBLIC_SAMPLE_DATA_ENABLED`) | **done** (D94, the owner's mockups): local and staging only; a sample menu in three sizes (Small 12, Standard 40, Large 150 items, with drafts, archived and sold-out items, no photos) loaded a step at a time through the real services, "Try again" / "Continue loading" after a stop; branch hours and 12 tables with QR codes; reset (type RESET) deletes every menu record and upload. server (`sample-data.service.test.ts` 9) + unit (`state.test.ts` 4) + browser-mock (`sample-data.test.ts` 9) + real-server (headless Chromium on `pnpm dev`: Standard in 2.5 s, Large in 6 s, hours and tables, reset) |
| products = "Menu items" | **new API** `/api/admin/menu/items`, `/api/admin/media` | **done** (3.8b part 3b, D70): grid and table, search, category filter, All/Draft/Published/Archived tabs; a slide-over form with image, leaf category, up to 2 option sets and the price grid (a price and an on/off switch per version), add-on groups with own rules and prices, availability rules; Publish / Unpublish / Archive (also bulk, in a Select mode) / Restore; an archived item opens read-only; on the UI standard (D89): rows on phones, the name opens the item, the grid by its container; the editor also as a page `/products/[id]` and `/products/new` (D90: one section at a time on phones, `?item=` opens the slide-over, the list picks by width when opening). unit + browser-mock (`products.test.ts` 28, `list-bulk.test.ts` 5) + real-server (headless Chromium on `pnpm dev`: create with image, grid, add-on, rule; publish → on the public menu; edit; archive → gone). **Not built:** order within a category, publish from the form, bulk publish |

Everything else (branches and tables, the customer website, orders, payments, loyalty, vouchers, reports) is not started; it is built in the numbered steps below. Community posts, carbon and banners from the old API have no product design and are out of scope until the owner asks for them.

## Next steps (recommended order)

The server follows the **server standard** ([docs/server/](server/README.md), D43; all server code since D71). Each phase gets a short plan before coding and ends with passing tests and an update here.

**How we work:** one step at a time. For each step the agent writes a short plan (for steps marked ✋, it asks first), builds it on its own branch, runs the local checks (lint, typecheck, unit/server tests and the changed feature's e2e files; AGENTS.md → Checks, D83), updates the docs, opens a PR whose CI runs the full suite, then **stops for review**. A step with new screens first goes through the mockup round ([feature-standard.md → Designing a UI step with mockups](feature-standard.md#designing-a-ui-step-with-mockups-the-owners-workflow)): prompts, the owner uploads frames and says "all uploaded", a review together, then "next" to build. The owner merges when the PR's checks are green. The next step starts only after approval. ✋ marks a step that needs a decision from the owner first (question numbers link to the Open questions table). ✅ marks a step that is done.

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
| 3.5b ✅ | **Add-ons on items:** add-on groups on an item with per-item rule and price overrides; "used by N items" for add-on groups | Tests |
| 3.6 ✅ | **Sold-out per branch:** `branch_item_states` + counter route (D64); stays until switched back (Q37) | Tests |
| 3.7 ✅ | **Availability rules** (overnight windows; no rule = always, several = any; D45, D63): the rules library, rules on items and categories, the pure window check. Built before 3.6 (they don't depend on each other) | Tests of the window rules |
| 3.8a ✅ | **Public menu API** (`GET /api/public/menu?branchId=`; no cache yet by the owner's choice, cache-ready: D65) | Public menu shows only active, available, in-stock versions |
| 3.8b ✅ | **Move the admin menu screens onto the new API, then remove the legacy menu** (owner, 2026-09-27: **don't delete the screens**; D66). Categories and Menu items must move **together** (the item form's category picker and the legacy items' foreign key), and the item form needs the Options and Add-ons pages, so 3.8b absorbs phase 4 in this order: **part 1 ✅ Availability page** (replaces Schedules as a screen); **part 2 ✅** Options (D67) and Add-ons (D68) pages (4.2, 4.3); **part 3** Categories and Menu items together (4.1, 4.4; [plan](plans/menu-screens-move.md)): **3a ✅ Categories** (D69), **3b ✅ Menu items** (D70), **3c ✅ removal** (D71), each verified in the browser (e2e + real-server), then remove `/api/v1`, `server/legacy`, the D41 tables, the Schedules screen and `shared/contracts/menu.ts`, and re-point AGENTS.md's reference-feature guidance | Every admin menu screen works on the new API; no code imports `server/legacy` |

### Phase 4: admin menu screens

| # | Step | Done when |
|---|---|---|
| 4.1 ✅ | **Categories** page (tree, sub-categories, drag order): done as 3.8b part 3 | e2e |
| 4.2 ✅ | **Options** page: done as 3.8b part 2 | e2e |
| 4.3 ✅ | **Add-ons** page: done as 3.8b part 2 | e2e |
| 4.4 ✅ | **Menu items** list and form (category picker, option sets, price grid, add-ons, availability rules, image): done as 3.8b part 3 | e2e |

### Phase 5: branches and the customer website

| # | Step | Done when |
|---|---|---|
| 5.1 | **Branch settings + dining tables** ([plan](plans/branch-settings.md), D91): **5.1a server** ✅ (settings and hours with one version, tables, QR tokens rebuilt from `NUXT_QR_SECRET` and stored hashed, rotation, `GET /api/public/tables/{token}`; server tests 22, real-server smoke on `pnpm dev`); **5.1b the Branch pages** done, awaiting review (D92) | Tests: unknown or archived tokens rejected |
| 5.2 | **Customer site shell:** SSR public pages ✅ (D95), SPA admin/counter (D45); the layout and `/admin` split are done (D93); sign-up / sign-in / verify / reset pages and the header's account states ✅ (D97), with light and dark mode (D96) | e2e of the account journeys |
| 5.3 | **Menu browsing:** categories as tabs, sub-categories as sections, item page with options and add-ons, QR table context: **5.3a** done, awaiting review (D93, with the order before checkout kept in the browser) | e2e |

### Phase 6: orders and counter payment

| # | Step | Done when |
|---|---|---|
| 6.1 | **Pricing and quote** (no tax or service charge; one voucher per order; D45): `POST /api/public/checkout/quote`, problems per line, limits 20 per line / 30 lines / 140-character notes / 10-minute quote ✅ (D98); vouchers join the quote in 7.5 | Totals match written examples |
| 6.2 | **Checkout** (only while open, ASAP pickup; D45): idempotent order placement, snapshots, pickup numbers per business day; cart and checkout on the site. **6.2a server** ✅ (D99: `POST /api/shop/orders`, `GET /api/shop/orders/{id}`, business day from 4:00, last orders 15 minutes before closing, 2 unpaid orders at most, dine-in by table QR); **6.2b the pages** ✅ (D100: `/checkout` Review order with notes, the sign-in and verify gates, price changes shown on the page, a dead table QR refused with Switch to pickup, Try again with the same key; `/orders/<id>` with the pickup number) | Replay and double-submit tests |
| 6.3 | **Counter queue, payment and actions** (owner, 2026-09-29: 6.4 folded in, since recording the payment is what starts preparation, D45): **6.3a server** done, awaiting review (D101: the queue; pay (cash USD, cash riel at the admin-set rate rounded up to ៛100, KHQR) → preparing; ready; complete; cancel (a paid order before ready records how the money went back, Q36); `order_events`; every command versioned and idempotent; the riel rate for admins); **6.3b the pages** (the counter app at `/counter` and the admin Payments page, from the owner's frames) next | Concurrent-action tests; one payment per order under retries |
| 6.4 ✅ | **Counter payment:** folded into 6.3 | |
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
- **Removed in step 3.8b (D71):** the D41 menu tables (categories with parents, schedules, products, variant groups and options, media), `/api/v1`, `server/legacy`, `shared/contracts/menu.ts`.
- **Kept and moved into the new layout:** `apiError`, the validation helpers, the batch guards, the origin check, audit events, media handling, the `server` test harness; in the app, `apiFetch` / `ApiError` (pointed at the new routes).
- **Admin screens:** Categories and Menu items moved onto the new API in step 3.8b (owner, 2026-09-27: the screens are kept, not deleted); Schedules became the Availability page (D66). Phase 4 was absorbed into 3.8b.

## Open questions / waiting on others

Business decisions the build still needs, with the step each blocks. All are for the **project owner**; nothing is built on a guess. Answered questions move to [decisions.md](decisions.md) (the 2026-09-27 round is D45) and out of this table.

| # | Question | Blocks | Suggested default |
|---|---|---|---|
| Q4 | Staging and production domains, and the email sending domain | 2.1, 8.2 | |
| Q24 | Acceptable data loss and downtime (RPO/RTO), who receives alerts and when, data retention and erasure periods | 8.2 | |
| Q37 | Should a sold-out switch **reset by itself** at the start of each business day, or stay until staff switch it back? | Nothing now (built as "stays", D64); a reset needs branch hours (5.1) | Stay until switched back; revisit when the counter screen is used |

## Known limitations

- Staging runs on Cloudflare (step 2.1): D1 migrations, both batch guards (stale version, last admin) under simultaneous requests, cron triggers and the outbox were verified there. R2 uploads and serving were verified on staging after step 3.2 (upload, byte-identical read-back, object present in the bucket), and the hourly `media:purge-temporary` deleted a backdated upload there (row and object). The CI deploy was checked step by step by hand (same commands, same smoke check); **its first run in GitHub is the merge of the phase 1–2 pull request**. Staging mail uses Resend's test sender, which delivers only to the Resend account's own address, until the sending domain exists (Q4). WAF rate limits need a custom domain (a `workers.dev` address isn't a zone we control); until then only Better Auth's own limits apply.
- The checkout quote (`POST /api/public/checkout/quote`, D98) is public and reads the whole catalog per call; until the WAF rate limits exist (they need a custom domain, Q4), nothing limits how often it's called.
- Uploads: abandoned or replaced images stay as `temporary` assets until a cleanup job exists. No sort-order UI for menu items.
- A 409 (someone else saved first) shows the server's message and keeps the form open. The Categories form and order offer Reload (latest version, input kept, D72); other forms still need close and reopen. No merge UI.
- Unsaved-changes comparison treats `1` and `'1'` as different and array order as meaningful (see docs/reference/forms.md).
- List filters in the URL support strings and numbers only, and one URL-synced list per page (`syncUrl: false` for others). See docs/reference/data-fetching.md.
- Data freshness: another device's change shows up only when the user returns to the tab or navigates (no push from the backend). No per-query opt-out yet. No polling (orders will likely need it per screen: D22).

## How to verify

- Before a PR: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` and the changed feature's e2e files; CI runs everything (AGENTS.md → Checks, D83). All pass as of 2026-09-29 (unit + server 661, e2e 315).
- **server:** `pnpm vitest run --project server`. Each test gets a fresh in-memory database from the checked-in migrations. To check that a concurrency test guards something, remove the guard (`requireOneChange`) and see it fail.
- **real-server (a first admin locally):** start `NUXT_SEED_ADMIN_EMAIL=you@example.com pnpm dev`, run `curl http://localhost:3000/_nitro/tasks/db:seed` (prints a temporary password), sign in at `/login` and choose your own password. More staff: the Staff page. `.data/db/sqlite.db` is the local database (stop the dev server before touching it: Windows locks it).
  - Pitfall: `@nuxtjs/better-auth` owns the `useState` keys `auth:*`. Don't name app state `auth:…`.
  - **Test data:** open **Sample data** in the admin sidebar (on for the dev server; D94): load a sample menu (Small, Standard or Large), branch hours and tables, and reset it all from there. No scripts.
  - Pitfall: sign-up checks the password against Have I Been Pwned (network needed): `password123` is refused with `PASSWORD_COMPROMISED`. Use a long random one. In a Claude Code cloud container the network policy blocks `api.pwnedpasswords.com`, so sign-up, change-password and reset-password answer 500; for a local smoke test, clear the seeded admin's flag in the throwaway `.data/db/sqlite.db` (`update user set must_change_password = 0 …`) instead of changing the password.
  - Pitfall: in Drizzle, ``exists(sql`select …`)`` renders the subquery without parentheses; write ``sql`(select …)` `` inside it, or SQLite reports `near "select": syntax error`.
  - Pitfall: drizzle's **D1** driver can't batch a raw ``db.run(sql`…`)`` that has bound parameters (it crashes reading `stmt.bind`); libsql can, so local tests never show it. Batch statements must be query-builder statements; the guards are `select`s (D53, test in `server/tests/batch.test.ts` with a stand-in D1 client).
  - Pitfall: `nuxt build --envName staging` doesn't apply `$production`; repeat what deployed builds need in `$env.<name>`.
  - Pitfall: a `compiled` key under `nitro.hooks` in nuxt.config **replaces** the Cloudflare preset's own `compiled` hook (which writes `wrangler.json`); add hooks from `nitro:init` instead.
  - Pitfall: Wrangler needs a browser login once per machine (`! npx wrangler login` in Claude Code); commands then run with `CI=1` to skip prompts.
  - Pitfall: `server/auth.config.ts` must not import a feature's `index.ts` (or anything reaching `hub:db` / `hub:db:schema`): the module loads it at build time and typecheck fails with NUXT_AUTH_CONFIG_LOAD_FAILED (D48).
  - **A table rename after step 2.1** (drizzle-kit would prompt): write the migration by hand. Generate a full snapshot into a temp folder (`npx drizzle-kit generate --dialect sqlite --casing snake_case --schema .nuxt/hub/db/schema.mjs --out <tmp>`), write `000N_<name>.sql` (`ALTER TABLE … RENAME TO …`, index renames, the new `CREATE`s copied from the temp SQL), copy the temp snapshot to `meta/000N_snapshot.json` with `prevId` = the previous snapshot's `id`, add the journal entry, then **`pnpm nuxt db generate` must say "No schema changes"**. Keep comments in the same statement as SQL (a comment-only statement between breakpoints can fail). Done for `0003_menu_categories` (D55).
  - Pitfall: drizzle-kit writes `DROP TABLE`s **parent-first**, which fails on a database with rows (D1 enforces foreign keys; a `restrict` reference is checked row by row as the table empties, a self-reference too). Reorder by hand, children first, and test the migration over linked rows (`server/tests/migrations.test.ts`, D71).
  - Pitfall: drizzle-kit **splits an index expression at its commas** (`coalesce(parent_id, '')` became broken SQL, in the migration and the snapshot). Write index expressions without commas (D55 uses two partial indexes).
  - Pitfall: schema changes add a migration (`pnpm nuxt db generate`, then rename it and its journal tag). Only a change `drizzle-kit` would ask about interactively (a rename) was handled by **regenerating** `0000_initial` while nothing is deployed (steps 1.2 and 1.5, D50); after such a regeneration a local `.data/db` must be deleted (dev server stopped). From step 2.1 on, never regenerate.
  - Pitfall: **D1 allows at most 100 bound parameters per statement** (checked on staging: 100 works, 101 fails with "too many SQL variables"); libsql allows 32,766. The test database now refuses more than 100 too (`server/tests/support/db.ts`), so a test at the largest allowed size catches it: add one to `server/tests/d1-limits.test.ts` for every list a statement takes (D62).
  - Pitfall: SQLite's `unixepoch('subsecond')` default can round 1 ms ahead of a JavaScript `Date` taken right after the insert, so "due now" comparisons against a row created a moment ago can miss. In tests, pass an explicit later `now` (the outbox tests do).
  - Account emails locally: without `NUXT_MAIL_RESEND_API_KEY` the dev server prints them (with the link) within a minute; `curl http://localhost:3000/_nitro/tasks/platform:deliver-outbox` sends at once.
  - Pitfall: `drizzle-kit generate` asks interactively when a column looks renamed, which fails in a non-interactive shell. Another reason to regenerate while nothing is deployed; after 2.1, write the rename as its own migration.
  - Pitfall: paths handed to NuxtHub's `hub:db:schema:extend` go into a generated import: use forward slashes on Windows ("Unterminated string constant" otherwise), like the error handler in D46.
  - Pitfall: a race test must make the race happen. Two `Promise.all` calls against in-memory SQLite can still run one after the other; hold both at the critical point (`meetingPoint` in `platform.service.test.ts`) and remove the guard to check the test fails.
  - Pitfall: a bash heredoc containing an apostrophe inside a quoted `'EOF'` block failed in this environment's shell wrapper ("unexpected EOF"). Write edit scripts with the editor instead.
  - Pitfall: to smoke-test a production build, run `node .output/server/index.mjs` with the `.env` variables **and** `NUXT_PUBLIC_SITE_URL` set; without it every auth-touching route answers 500 (logged as "siteUrl required in production").
  - Pitfall: backticks inside a `node -e "…"` script in bash are command substitution: they vanish silently. Use a script file or the editor for text containing backticks.
  - Pitfall: several repo files use CRLF line endings; a Node text replacement with LF anchors silently matches nothing. Normalize (`replace(/\r\n/g, '\n')`) before replacing, and check the replacement happened.
- **e2e (preferred):** `pnpm vitest run --project e2e`. Add scenarios to `test/e2e/` instead of throwaway scripts. The build is reused while nothing it reads changed (`test/e2e/support/global-setup.ts`, D83: "[e2e] Reusing the build" in the log); `E2E_REBUILD=1` forces a build, CI always builds. Measured: a feature file takes ~27 s reusing the build, ~65–90 s with one. Pitfalls met so far:
  - In a Claude Code cloud container the e2e harness can't find Google Chrome (`launch: { channel: 'chrome' }` in `test/e2e/support/mock-api.ts`; "Run pnpm exec playwright install chrome"). Run the e2e tests there with that line temporarily changed to `launch: { executablePath: '/opt/pw-browsers/chromium' }`, and don't commit the change. Font-provider fetch errors in that run's log are harmless.
  - **Toast actions can't be reached while a modal or slide-over is open**: the overlay hides the rest of the page (`aria-hidden`), toasts included, so `getByRole('button', …)` never finds a toast's button (and neither can a keyboard or screen-reader user). Put an action the user needs while the overlay is open inside the overlay (the Options editor's Reload alert, D67). "Reopen" toasts are fine: they appear after the modal closed.
  - `expect.poll` defaults to a 1 s timeout; a cold page (session → refresh → redirect) can take longer under full-suite load. The e2e project sets 5 s (`vitest.config.ts`). Flaky "expected /categories to be /login" failures came from this.
  - **Escape also dismisses Reka toasts.** A test that presses Escape to close a modal may silently close the toast it later checks. Close modals with their button when toasts matter.
  - `UIcon` renders `aria-hidden`, so `getByLabel('Working…')` doesn't find the busy spinner. Use `locator('[aria-label="Working…"]')`.
  - **An SPA route change isn't a page load:** `waitForLoadState` returns at once after a link click (the page reached that state on its first load). Before the next click, wait until the router has committed the navigation (`waitForURL`); a click during a pending navigation cancels it (below). `gotoViaSidebar` does this since 2026-09-29, and returns once the last navigation is committed.
  - Vitest hides `console.log` from passing e2e tests. To inspect a value while debugging, assert it against a sentinel and read the failure message (`expected +0 to be 99`: mind the `+`).
  - To check that a test guards a behavior, disable the behavior (move a plugin away, drop an option) and confirm the test fails. Several tests written in this project passed vacuously at first.
  - `UForm` debounces input validation (~300 ms). After `fill()` on a field showing an error, wait for the error to disappear before clicking anything below it, or the layout shift makes the click miss (`check()` then reports "did not change its state").
  - A modal's header X and a footer button can both be named "Close". Scope to `[data-slot="footer"]`.
  - `UInputTime` / `UInputDate` render segments (`role="spinbutton"`), not an `<input>`: `fill()` and `getByLabel(<field label>)` don't work (the label targets a hidden input). Give the component an `aria-label`, find it with `getByRole('group', { name })`, click the first segment and type digits (`'0830'`); typing replaces an existing value. See `typeTime` in `test/e2e/availability-rules.test.ts`.
  - A `position: fixed` bar inside a `space-y-*` parent still gets the parent's `margin-bottom`, so `bottom-0` ends 16 px short (D72). `BottomActionBar` resets it (`max-lg:m-0`, D78); the phone e2e tests check the bar's bottom edge.
  - `BottomActionBar` steps aside while a text field has focus (the on-screen keyboard): after `fill()`, call `.blur()` before looking for a button in the bar (D78).
  - Nuxt UI renders `data-slot="base"` on its controls' root element: `ui-foundations.test.ts` uses it to measure only Nuxt UI controls.
  - Text shown twice for different widths (a mobile meta line and a desktop column) matches twice, one hidden: use `getByText(…, { exact: true }).filter({ visible: true })`.
  - Nuxt UI's `defineShortcuts` (and so `usePageShortcuts`) calls `preventDefault` on every key it matches. Registering `escape` there stops Escape closing menus and selects, and the page behind stays `aria-hidden`: tests then time out finding the next button. Listen for Escape with a plain keydown listener that leaves the default alone (Categories, D72).
  - `BulkActionsBar` disappears when the selection clears (no fade since D78), but the list updates after the answer: poll for "N selected" to disappear instead of counting at once.
  - The Categories tree and `CategorySelect` both call `GET /staff/categories/all` (the picker with `type=MAIN`): a mock must answer by query, and a "list loads" count must skip `type` requests (see `freshness.test.ts`, `pickers.test.ts`).
  - Status-tab counts call the list endpoint with `size=1`: exclude those when counting list requests (`isCount` in `list-page.test.ts`).
  - Row buttons are named after the item ("Actions for Tea", "Select Tea"), so a user-menu button like "alice" needs `{ exact: true }` once an item contains that name.
  - `page.reload()` has no `waitUntil: 'hydration'`; use `page.goto(page.url(), { waitUntil: 'hydration' })`.
  - Under load, a full `pnpm test` once hit a wave of 30 s timeouts in unrelated files right after another e2e run; the rerun passed. Rerun before chasing such a failure. Seen again in step 1.3: the two-tab tests (`auth`, `freshness`, `session`) time out only when `pnpm test` runs every project at once; alone, and in `pnpm test:e2e`, they pass. **Found and fixed (2026-09-29):** `unsaved-changes` "asks on browser forward" (3.8b part 2a, D74, D75, D80, D90) and "shows one dialog when back is pressed twice" (3b) were not load flakes but a race in `gotoViaSidebar`. It clicked Categories, Dashboard, Categories back to back, waiting only on `waitForLoadState` (which returns at once). Under load the page's JavaScript slows but Playwright's clicks don't, so the Dashboard click could land while `/categories` was still in the router's async guard chain. Vue Router then sets the pending location to `/` before finding it duplicates the current route, which cancels the `/categories` navigation, and neither click pushes a history entry. The history was `about:blank, /, /categories` instead of five entries, so the test's second Back left the app. Reproduced with CPU throttling (`Emulation.setCPUThrottlingRate`, 4×): "at /categories after the second Back" got `about:blank` with `history.length` 3. Fixed by waiting for each navigation's URL before the next click. Rule: never click a second in-app link before the first route change committed.
  - `getByLabel` matches **substrings**: `'Name'` also matches "Name of group 1", and "Option 2 of Milk" matched "Extra price of option 2 of Milk". Use `{ exact: true }`, or labels that can't contain each other.
  - `mockApi` keys drop `/api` for every surface (`'GET /admin/me'`, `'GET /public/menu'`).
  - **The customer site's tests use no mocks (D95):** it renders on the server, where `mockApi` can't reach. The e2e build keeps its data in `.data/e2e` (never your dev database), and `test/e2e/support/seed.ts` rebuilds it before each run with the Standard sample menu: "Riverside" open around the clock, "Zeta Kiosk" with no hours, table QR tokens in `inject('shopSeed')`. Items with a time rule (the croissants at breakfast, Affogato late at night) come and go with the clock: don't assert on them.
  - **A test that changes a seeded customer** (verifies, resets, places orders) owns that customer: files run in any order against one seeded database, so no other file may rely on its state. `shop-orders-api.test.ts` used the customer `shop-account.test.ts` verifies and failed whenever the account file ran first (found in 6.2b); each file now has its own (`seed.ts`).
  - **The account tests (D97)** sign in as the seeded customers (`inject('shopSeed').customers`) and read the verification and reset links the server queued from its outbox (`mailLink` in `shop-account.test.ts`), filtered by address and time. Sign-up and saving a new password ask Have I Been Pwned from the server, so the tests mock only those answers in the browser (`page.route('**/api/auth/sign-up/email')`); everything else is the real server.
  - Nuxt UI's `UForm` doesn't always show the error of a field that was never touched: with the email typed and the password empty, submitting showed only the email's error. Tests of the empty form submit it untouched; a typed field's error appears on blur (press Tab).
  - `pkill -f <pattern>` in this environment's shell kills the shell running it too (its own command line contains the pattern: exit code 144). Find the process id with `ps aux | grep "[i]ndex.mjs"` instead.
  - The e2e database is deleted before each build: the seed recreates it without NuxtHub's migration record, and a build over a leftover one fails with "table `account` already exists".
  - A production build's Better Auth answers 500 without `NUXT_PUBLIC_SITE_URL` and `NUXT_BETTER_AUTH_SECRET`; the e2e server gets test values (global-setup). Seen as "Failed to load resource: 500 … /api/auth/get-session" in a test's console.
  - Hydration: Vue's production build logs "Hydration completed but contains mismatches." as a console error; `shop-menu.test.ts` fails on it. Anything that differs by width on a server-rendered page must be CSS, and browser storage must be read after mounting.
  - A section near the end of the menu can't scroll to the top under the header: tests check it's in view below the header, not at the top.
  - `mockApi` maps a path segment to `{id}` only when it contains a digit: a test id like `missing` stays literal and is reported as unmocked. Use ids with a digit (`grp-404`).
  - A page that refetches after a mutation (the Add-on group page, via `invalidate`) needs **stateful** mocks: a GET that keeps answering the original record overwrites what the mutation returned. `modifier-groups.test.ts` keeps the last answer per id (`latest`).
  - SortableJS drag and drop works with Playwright's `locator.dragTo(target)` on the drag handle (target another handle). Inside a `USlideover` or `UModal`, pass `watchElement: true` to `useSortable`: the overlay renders its body after the component mounts, so without it Sortable is never created and dragging silently does nothing (keyboard moves still work) (D73).
  - A closing slide-over stays on screen for its animation, so "still open after Escape" passes vacuously if the test only checks a button is visible. Keep using the editor afterwards (open an edit, expand a section) and check `data-state="open"` (D73). Reka closes an overlay on Escape only when nobody called `preventDefault`: an input that handles Escape itself keeps the overlay open that way.
  - `UInputNumber` is `role="spinbutton"` (not a textbox); `fill('4.2')` works and it shows `$4.20` after blur. **Its model only updates on blur**: call `.blur()` after `fill()` before checking anything that depends on the value (the Add-ons rule checks).
  - A checkbox that shows the server's state (the Add-ons "Pre-selected", saved at once) changes only after the answer, or never if refused: `check()` then fails with "did not change its state". Use `click()`.
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
