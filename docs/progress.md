# Progress

_Last updated: 2026-09-26 (List UI refresh)._ Update this file whenever you finish or start work (see AGENTS.md → "Resuming work").

## Verification levels

Every "done" item states how it was checked. Keep using these labels:

- **unit**: covered by Vitest (`pnpm test`)
- **browser-mock**: exercised in a real browser (headless Chrome) against a mocked API (see "How to verify" below)
- **real-API**: exercised against `dev-api.nukcafe.co` with a real staff login
- **unverified**: written but not exercised

## Current state

**Full stack direction (2026-09-26):** the owner chose one Nuxt backend for the admin, customer, and cashier apps, using `@nuxtjs/better-auth`, NuxtHub, Drizzle, SQLite/D1, and R2, with a new schema and no Spring data migration. The [backend and data model draft](plans/fullstack-backend.md) covers the proposed tables, request flows, phases, and decisions still needed. **Planning only, unverified:** no server code, schema, migration, or Cloudflare deployment has been added. The current Spring API frontend remains in use. Next: settle the phase 0 identity/permission and currency contracts, then validate the stack locally and in staging.

**Greenfield product blueprint (2026-09-26):** [system-blueprint.md](plans/system-blueprint.md) now starts from customer, staff, and manager journeys. Confirmed launch scope: customer website, pickup and dine-in with table QR, USD, one branch, email/password accounts with no guest ordering, pay at counter before preparation, points earned at 1 per USD after completion and exchanged for vouchers, and staff-issued vouchers; native app, delivery, and online payment are outside that scope. Product policy questions are listed in the blueprint. This is still planning only; the current app is untouched by the new design.

The foundation is complete. Categories is the reference feature; Schedules ([plan](plans/schedules.md)) and Products / "Menu items" ([plan](plans/products.md)) are built. Nothing has been tested with a real staff login yet: no credentials were available. Only unauthenticated calls (session check, failed login, error shapes) were checked against the real dev API.

### Foundation

| Area | Status | Verified |
|---|---|---|
| Nuxt 4 SPA + Nuxt UI dashboard shell, sidebar navigation, error page | done | browser-mock |
| Generated SDK from OpenAPI (`pnpm api:generate`, `/staff` + `/admin` only) | done | typecheck |
| API layer: envelope handling, cookie credentials, single-flight token refresh, 30s timeout | done | unit, browser-mock |
| **Hardening (2026-09-26, [plan](plans/admin-foundation-hardening.md)):** bounded refresh (10 s), no hidden ofetch retries, expire once per identity, no refresh loop (D27) | done | unit (incl. real ofetch) |
| Record locks across mutations; prototype-safe mutation keys (D28) | done | unit (incl. reactivity); e2e bulk delete during a pending edit |
| Session-transition contract: generation, stale-response discard, boundary cleanup (D29) | done | unit; e2e `session.test.ts` (each mechanism checked by disabling it) |
| `useApiQuery` `watch` cancels instead of queueing (D30) | done | e2e (fails without the fix) |
| `CategorySelect`: error + Retry, current value always visible, inactive not offered while Q9 is open; no blur validation in the Category form (D31) | done | e2e `pickers.test.ts` |
| Strict e2e harness (unmocked requests fail) + `deferred`, `paginatedHandler`, `failures` | done | proven with a throwaway failing test |
| Dev proxy `/api` with `Origin` rewrite | done | real-API (unauthenticated) |
| Error handling: `ApiError` classification, user-safe messages, `ApiErrorAlert`, `useNotify`, safety-net plugin | done | unit, browser-mock, real-API (error shapes) |
| Auth: login page, session check, global guard, logout, redirect on session loss | done | browser-mock, real-API (failed login only) |
| Icons bundled into the client build, no runtime Iconify API calls (D18) | done | build output (all app icons present in the bundle); not yet checked in a browser |
| Unsaved-changes guard: modal close (X/Esc/outside/Cancel), route changes incl. back/forward, logout, tab close/reload; one dialog for many forms (D19) | done | unit (`form-value`), e2e (`unsaved-changes`, `session`): failed save, forward, expiry and other-tab logout with a dirty form. Not browser-tested: voluntary logout with a dirty form (a modal covers the menu; no page form exists) |
| Browser tab titles per page (D23) | done | e2e |
| List pages: filters/page in the URL, search as you type, empty states (D21) | done | unit (`query`), e2e (`list-page`) |
| Data freshness: cross-tab invalidation, refetch stale (≥ 5s) data on return, refetch on reconnect, offline banner (D22) | done | e2e (`freshness`: two tabs in one context, faked visibility and clock, offline). The two-tab test was checked to fail with the broadcast disabled |
| Login: password hidden with show/hide toggle (Q7) | done | e2e |
| E2E harness: one build, `mockApi`, 45 tests (auth, categories, lists, unsaved changes, freshness, shortcuts, shell) (D20) | done | runs in `pnpm test` and CI |
| Login/logout across tabs (D26) | done | e2e (checked to fail with the broadcast disabled) |
| Open-redirect fix: `?redirect=//other-site` after login now goes to `/` (D26) | done | e2e |
| Keyboard shortcuts: `/`, `N`, Ctrl/⌘+Enter, `?` list (D25) | done | e2e (the behind-a-dialog guard was checked by removing it) |
| CI: GitHub Actions runs lint, typecheck, unit and e2e (D24) | written | **not run yet**: first run on the next push. YAML validated locally |
| Feature architecture + ESLint boundary rules | done | lint (violations verified to be reported) |
| CRUD state: `useApiQuery`, `useMutation` (per-item concurrency, shared state, batch, Stop, Retry failed), `useTableSelection`, `BulkActionsBar`, leave-page guard | done | unit (engine), browser-mock (all async scenarios) |
| **List UI refresh (2026-09-26, [plan](plans/list-ui-refresh.md), D37):** `StatusTabs` + `useStatusCounts`, floating `BulkActionsBar`, `ListSkeleton`, selection helpers for cards/trees | done | e2e on all three pages; light + dark screenshots |

### Features

Backend resources available (from the spec) and their status. The folder names follow the backend resources (see decisions D9).

| Feature | Endpoints (`/staff/...`) | Status |
|---|---|---|
| auth | `auth/login`, `session`, `refresh`, `logout` | done |
| categories (menu) | `categories`, `categories/{id}`, `categories/all`, `categories/sort-order` | **done, reference feature** (**tree** of mains and subs, client search + status tabs, create/edit, **Add sub-category**, delete, batch delete, **drag-to-sort per level**, subs numbered per main: D37 supersedes D36; unit + e2e `categories.test.ts`, not checked against the real API) |
| schedules (menu) | `schedules`, `schedules/{id}`, `schedules/all`, `schedules/available`, `schedules/days-of-week` | **done** ([plan](plans/schedules.md)): list (search, status, day filter), create, edit (items shown read-only and kept), delete + bulk delete for schedules not in use. **Evidence:** unit (form mapping, days) + browser-mock (e2e `schedules.test.ts`, 13 tests; the lock test fails without `lock`). Response formats checked against the real dev API through the unauthenticated `/public/schedules/**` endpoints. **No authenticated real-API check:** every request encoding (S1–S7) is unverified. `ScheduleSelect` comes with Products |
| products = "Menu items" | `products`, `products/{id}`, `products/all`, `products/category/{id}`, `products/upload`, `products/sort-order` | **done, phases 1 + 2** ([plan](plans/products.md)): list (name search, category, status), create/edit in a slide-over (image upload + replace, category, USD price, description, schedules, status, **variant editor**: groups/options, required, pick several, option prices, drag-and-drop or keyboard reorder, reply check D35), delete + bulk delete. **Evidence:** unit (mapping, prices, `variantMismatches`) + browser-mock (e2e `products.test.ts`, 15 tests). Response formats checked through the unauthenticated `/public/products/**` endpoints. **No authenticated real-API check** (P2–P6 unverified). **Not built:** sort order, price-range filter, removing an image |
| rewards (+ reward categories) | `rewards`, `rewards/{id}`, `rewards/{id}/status`, `rewards/upload`, `reward-categories`, … | not started |
| vouchers | `voucher/catalogs…`, `vouchers/redeem`, `vouchers/lookup`, `voucher/activity` | not started |
| banners | `banners`, `banners/{id}`, `banners/upload`, `banners/{id}/toggle-status`, `banners/dashboard` | not started |
| customers | `customers`, `customers/{id}` + vouchers/rewards/posts/points/orders, `suspend`, `reactivate` | not started |
| staff (admins, cashiers) | `staff`, `staff/{id}`, `admins`, `cashiers`, `reset-password`, `status` | not started |
| orders | `orders/{id}` (accept/ready/complete/reject/cancel), `orders/pickup-queue`, `/admin/orders` | not started |
| points, loyalty | `points/settings`, `points/history`, `loyalty/...` | not started |
| community posts | `community-posts`, approval status, comments, likes, dashboard | not started |
| carbon | `carbon/projects`, `carbon/stats`, `carbon-settings`, `carbon-metadata` | not started |
| dashboard, activity log, files, notifications, profile (`me`) | `dashboard`, `activity-log`, `files`, `me/...` | dashboard is a placeholder page; rest not started |

## Next steps (recommended order)

**Feature standard (2026-09-26, docs only; revised twice after review the same day):** [docs/feature-standard.md](feature-standard.md) defines planning, structure, list/form/picker behavior, the capability roadmap and the definition of done. The revision separates reversible **[Choice]** items from **[Open]** backend/business/authorization contracts, which developers must not invent (defer the affected behavior, continue the rest). It replaces "encode clearing explicitly" with "map intent through the established contract, defer unknown clears", allows form-local submission state and justified screen-specific polling, and corrects an overstatement: row blocking is **not** enforced for bulk actions (an implementation gap, below). Checked: relative links and anchors resolve (script), `git diff --check`, only docs changed. Statements about existing behavior were re-checked against the code; the first version had overstated busy-row protection. Second revision: pickers separate **displaying an existing value** from **allowing a new selection** (a listing endpoint isn't eligibility evidence; unresolved eligibility is deferred, not defaulted, Q9). Schedules deletion is deferred until its effect on referenced products is known. The concurrency guarantee is stated as check-and-reserve at request start: `isBusy` prefiltering is only a preliminary check, and the engine has no cross-mutation exclusion (mutations.md). No application behavior was changed or newly verified. Gaps in the reference feature (not fixed): Q7 (clearing a parent), bulk delete vs pending update (below), `CategorySelect` has no error/unavailable-value states, no committed tests for row blocking, selection reset or last-page step-back. *Update:* all but Q7 were fixed by the foundation hardening (plans/admin-foundation-hardening.md).


0. **Schedules done (2026-09-26):** see the [plan](plans/schedules.md) and D32. **First thing on a staff login:** run the plan's "verify on first staff login" column (time format, `items` kept on edit, delete of an unused schedule), then Q7 for Categories.
0. **Foundation hardening done (2026-09-26):** see the [plan and results](plans/admin-foundation-hardening.md).
0. **Polish done (2026-09-26):** e2e harness, tab titles, hidden password, list URL state + live search + empty states, refresh on return/reconnect + offline banner. Still open before features: role rules (Q6, waiting on the project owner).
1. **Test Categories against the real API** with a staff login (`pnpm dev`, then create, edit, delete, batch delete). Record any new error codes in `API_ERROR_CODES` (`app/utils/api-error.ts`). Update the verification levels above.
2. ~~Schedules~~ done (`ScheduleSelect` + `useScheduleOptions` were added with Products).
3. ~~Products phases 1 + 2~~ done (D34, D35). Later: sort order per category (drag and drop is now available via `useSortable`), `ProductSelect` for the schedule form. `ProductImageInput` moves to the root when Rewards/Banners/Vouchers need uploads (D16).
4. Rewards (+ reward categories), then vouchers and banners (all need image upload and status toggles).
5. Customers, staff, orders, and the rest.
6. Every new feature adds `test/e2e/<feature>.test.ts` (AGENTS.md → "Adding a feature", step 9).

## Open questions / waiting on others

| # | Question | Owner | Impact |
|---|---|---|---|
| Q1 | Full list of backend error codes (`msg`). Only `NC0000`, `NC0001`, `NC0011`, `NC0014`, `NC1000`, `LOGIN_FAILED` have been observed | backend team | Better error messages and kinds (e.g. a "forbidden" code) |
| Q2 | Unique, stable `operationId`s in Springdoc (today `createCategory1`, `update_2`, …) | backend team | Clean SDK names that survive regeneration |
| Q3 | Mark required fields in the spec (all response fields are optional today) | backend team | Fewer `!` / `??` in the UI |
| Q4 | Production hosting domain for the portal. It must be same-site with the API (e.g. `admin.nukcafe.co`), or the auth cookies are dropped | project owner | Deployment (`NUXT_PUBLIC_API_BASE`) |
| Q5 | Should admins edit translations (`nameI18n` / `descriptionI18n`: en, zh-HK, km)? Forms currently edit English only and preserve the rest | project owner | `I18nFields` component |
| Q6 | Role rules: the session has `groups` (e.g. ADMIN, CASHIER). Which screens and actions does each role get? No role-based UI exists yet | project owner | Route guard + hidden actions |
| Q7 | `PUT /staff/categories/{id}` with `mainCategoryId` omitted: does it clear the parent or keep it? The Category form relies on "clear" (unverified) | backend team | Clearing a parent may silently not work |
| Q8 | How does the backend handle two concurrent updates of the same record (last write wins, rejection, versioning)? No version field in the generated types for categories | backend team | Edit-conflict handling |
| Q9 | Which records may be chosen for a **new** relationship? e.g. may an inactive category be picked as a parent or as a menu item's category? A listing endpoint returning them isn't evidence | project owner (backend team if it enforces a rule) | Picker eligibility. **Deferred:** `CategorySelect` no longer offers inactive categories as new choices (D31); an existing inactive value stays |
| Q10 | CSRF: does the backend protect cookie-authenticated POST/PUT/DELETE (CSRF token, `Origin`/`Referer` check, required `application/json`, custom header)? `SameSite=Lax` doesn't stop same-site (`*.nukcafe.co`) origins | backend team | Whether any frontend change (e.g. sending a token/header) is needed. None made: no contract exists |
| Q11 | CORS with credentials: which exact origins are allowed? Is any wildcard or sibling subdomain (user content, marketing) on `nukcafe.co` allowed or hosted? | backend team / project owner | Same-site attack surface for the cookies |
| Q12 | The spec declares only `bearerAuth`, but the portal uses cookies. Are both accepted on `/staff/**`, and is the spec's security section authoritative? | backend team | Which auth path the CSRF review applies to |
| Q13 | Schedules: request format of `startTime`/`endTime` (responses are `HH:mm`), and does the backend apply them as UTC (`timezone: "UTC"`)? | backend team | **Decided for the UI (D33):** converted between the record zone and the viewer's browser zone, 12-hour on screen. If the backend really stores local time labelled UTC, every schedule displays shifted by the viewer's offset |
| Q14 | Schedules: are overnight ranges (22:00–02:00) valid? | project owner + backend team | No rule of our own; the backend decides (S3) |
| Q15 | `PUT /staff/schedules/{id}`: does `items` replace, merge or append, and what does an omitted `items` mean? | backend team | Edit re-sends the existing ids (safe under replace or merge; S4). Blocks editing items from the schedule form |
| Q16 | Deleting a schedule that menu items use: rejected, links removed, or products changed? Does `items` reflect products' `scheduleIds`? | backend team | **Deferred:** only schedules not in use can be deleted (S6) |
| Q18 | Products: how does `PUT /staff/products/{id}` treat `variants`? Are ids matched (update in place), are omitted variants/options deleted, are new ones (no id) created? | backend team | The editor sends the full list (removed rows left out) and **warns if the reply differs** (D35). Verify on first login |
| Q20 | ~~Sub-category numbering~~ **Decided (user, D37): per main category**, matching the data. Verify on a staff login that the apps show the saved order | backend team | |
| Q19 | Product images: accepted types and size, how to clear an image, whether replaced or abandoned uploads must be deleted, what `ownerId` on upload is for | backend team | Own limit JPEG/PNG/WebP ≤ 5 MB; no remove button; no cleanup (P4, P5) |
| Q17 | Schedules: must a schedule have at least one day and both times? Allowed `sortBy`/`sortDir` values? Is `items[].price` a schedule price, and in which unit? | project owner / backend team | Required in the form by choice (S10, S11); no sort UI; price not shown |

## Known limitations

- No real-API verification of any authenticated flow (see Current state).
- Products: whether removed variants are really deleted is unverified (a warning shows if the reply differs, Q18); an image can be replaced but not removed; uploads abandoned by cancelling the form stay on the server (Q19); no sort-order UI.
- Schedules: the day filter matches stored (UTC) days, not the converted ones shown; timezone offsets are taken at today's date (DST zones shift by the current offset all year) (D33).
- Schedules: a schedule's menu items can't be edited from the schedule form (read-only; linked from the menu-item form once Products exists), and schedules in use can't be deleted (Q16). If a menu item is linked between opening the edit form and saving, the save re-sends the older item list (same class of problem as Q8).
- Nothing is role-aware (Q6). The question matrix is in app-behavior.md → Permissions; no role gating was built, and the backend must enforce.
- No client-side edit-conflict handling; backend behavior unverified (Q8).
- Unsaved-changes comparison treats `1` and `'1'` as different and array order as meaningful (see docs/reference/forms.md).
- List filters in the URL support strings and numbers only, and one URL-synced list per page (`syncUrl: false` for others). See docs/reference/data-fetching.md.
- Data freshness: another device's change shows up only when the user returns to the tab or navigates (no push from the backend). No per-query opt-out yet. No polling (orders will likely need it per screen: D22).

## How to verify

- `pnpm lint`, `pnpm typecheck` and `pnpm test` must pass before finishing any change.
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
  - Under load, a full `pnpm test` once hit a wave of 30 s timeouts in unrelated files right after another e2e run; the rerun passed. Rerun before chasing such a failure.
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
  - Two tabs of one browser: `createPage()` opens a single-page context, so create one with `(await getBrowser()).newContext()`, open both pages in it, and wait with `waitForHydration(page, url, 'hydration')` (raw pages lack the `waitUntil: 'hydration'` wrapper). Tabs in one context share `BroadcastChannel`.
  - Tab visibility: fake `document.visibilityState` + dispatch `visibilitychange`, and move time with `page.clock.install()` / `fastForward`. Offline: `page.context().setOffline(true)` (fires the `offline` event; `page.route` mocks still answer).
  - In a `node -e` one-liner inside single-quoted bash, `\d` in a regex loses its backslash. Edit test files with the editor, not shell string replacement.
- **browser-mock (ad hoc):** start `pnpm dev --port 3123`, then drive headless Chrome with `playwright-core` (`chromium.launch({ channel: 'chrome' })`) and mock the backend with `page.route('http://localhost:3123/api/**', …)`. Pitfalls met so far:
  - Use the full origin in the route pattern. A bare `**/api/**` also matches the Vite module `/_nuxt/generated/api/*.ts` and breaks the app.
  - `UAlert` has no `role="alert"`. Match on text.
  - Headless Chrome doesn't show the `beforeunload` dialog. Verify the guard by dispatching a cancelable `beforeunload` event and checking `defaultPrevented`.
  - Stopping the dev-server task can leave an orphaned Nuxt process holding the port and the lock ("Another Nuxt dev server is already running"). Kill it by port (`Get-NetTCPConnection -LocalPort 3123`) before restarting.
- **real-API:** `pnpm dev` (port 3000 is fine; the proxy rewrites `Origin`) and log in with a staff account.

## Environment notes

- Windows, pnpm 12. Bash (Git Bash) and PowerShell are both available. **Python is not installed.**
- `pnpm nuxt prepare` regenerates `.nuxt/`. Run it if lint or typecheck reports missing `.nuxt/*` files or new auto-imports aren't recognized.
