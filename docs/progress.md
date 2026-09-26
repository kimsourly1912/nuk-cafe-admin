# Progress

_Last updated: 2026-09-26._ Update this file whenever you finish or start work (see AGENTS.md → "Resuming work").

## Verification levels

Every "done" item states how it was checked. Keep using these labels:

- **unit**: covered by Vitest (`pnpm test`)
- **browser-mock**: exercised in a real browser (headless Chrome) against a mocked API (see "How to verify" below)
- **real-API**: exercised against `dev-api.nukcafe.co` with a real staff login
- **unverified**: written but not exercised

## Current state

The foundation is complete and one feature (Categories) is built as the reference. Nothing has been tested with a real staff login yet: no credentials were available. Only unauthenticated calls (session check, failed login, error shapes) were checked against the real dev API.

### Foundation

| Area | Status | Verified |
|---|---|---|
| Nuxt 4 SPA + Nuxt UI dashboard shell, sidebar navigation, error page | done | browser-mock |
| Generated SDK from OpenAPI (`pnpm api:generate`, `/staff` + `/admin` only) | done | typecheck |
| API layer: envelope handling, cookie credentials, single-flight token refresh, 30s timeout | done | unit, browser-mock |
| Dev proxy `/api` with `Origin` rewrite | done | real-API (unauthenticated) |
| Error handling: `ApiError` classification, user-safe messages, `ApiErrorAlert`, `useNotify`, safety-net plugin | done | unit, browser-mock, real-API (error shapes) |
| Auth: login page, session check, global guard, logout, redirect on session loss | done | browser-mock, real-API (failed login only) |
| Feature architecture + ESLint boundary rules | done | lint (violations verified to be reported) |
| CRUD state: `useApiQuery`, `useMutation` (per-item concurrency, shared state, batch, Stop, Retry failed), `useTableSelection`, `BulkActionsBar`, leave-page guard | done | unit (engine), browser-mock (all async scenarios) |

### Features

Backend resources available (from the spec) and their status. The folder names follow the backend resources (see decisions D9).

| Feature | Endpoints (`/staff/...`) | Status |
|---|---|---|
| auth | `auth/login`, `session`, `refresh`, `logout` | done |
| categories (menu) | `categories`, `categories/{id}`, `categories/all`, `categories/sort-order` | **done, reference feature** (list, filters, create/edit, delete, batch delete). Sort order not built |
| schedules (menu) | `schedules`, `schedules/{id}`, `schedules/all`, `schedules/available`, `schedules/days-of-week` | not started |
| products = "Menu items" | `products`, `products/{id}`, `products/all`, `products/category/{id}`, `products/upload`, `products/sort-order` | not started |
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

1. **Test Categories against the real API** with a staff login (`pnpm dev`, then create, edit, delete, batch delete). Record any new error codes in `API_ERROR_CODES` (`app/utils/api-error.ts`). Update the verification levels above.
2. **Schedules.** Build it before products, because the menu item form needs `ScheduleSelect`. Needs a days-of-week picker and a time range. Export `ScheduleSelect` + `useScheduleOptions` from its `index.ts`.
3. **Products ("Menu items").** Uses `CategorySelect` and `ScheduleSelect`. It's the first user of image upload, `nameI18n`/`descriptionI18n` and variants. Build `ImageUpload` and `I18nFields` inside the feature first, and promote them to the root when the second feature needs them (decisions D16). Then give schedules a `ProductSelect` (the bidirectional link: decisions D8).
4. Rewards (+ reward categories), then vouchers and banners (all need image upload and status toggles).
5. Customers, staff, orders, and the rest.
6. Turn the throwaway browser-mock scripts into committed e2e tests in `test/e2e/` (none are committed yet).

## Open questions / waiting on others

| # | Question | Owner | Impact |
|---|---|---|---|
| Q1 | Full list of backend error codes (`msg`). Only `NC0000`, `NC0001`, `NC0011`, `NC0014`, `NC1000`, `LOGIN_FAILED` have been observed | backend team | Better error messages and kinds (e.g. a "forbidden" code) |
| Q2 | Unique, stable `operationId`s in Springdoc (today `createCategory1`, `update_2`, …) | backend team | Clean SDK names that survive regeneration |
| Q3 | Mark required fields in the spec (all response fields are optional today) | backend team | Fewer `!` / `??` in the UI |
| Q4 | Production hosting domain for the portal. It must be same-site with the API (e.g. `admin.nukcafe.co`), or the auth cookies are dropped | project owner | Deployment (`NUXT_PUBLIC_API_BASE`) |
| Q5 | Should admins edit translations (`nameI18n` / `descriptionI18n`: en, zh-HK, km)? Forms currently edit English only and preserve the rest | project owner | `I18nFields` component |
| Q6 | Role rules: the session has `groups` (e.g. ADMIN, CASHIER). Which screens and actions does each role get? No role-based UI exists yet | project owner | Route guard + hidden actions |
| Q7 | `LoginPage.vue` password input has no `type="password"` (removed in a manual edit), so passwords show in plain text. Confirm whether that was intended | project owner | Security/UX |

## Known limitations

- No real-API verification of any authenticated flow (see Current state).
- Search inputs apply on Enter or blur (`v-model.lazy`), not as you type. There's no debounce utility yet.
- Category sort order (`/staff/categories/sort-order`) has no UI.
- Nothing is role-aware (Q6).
- No committed e2e tests.

## How to verify

- `pnpm lint`, `pnpm typecheck` and `pnpm test` must pass before finishing any change.
- **browser-mock:** start `pnpm dev --port 3123`, then drive headless Chrome with `playwright-core` (`chromium.launch({ channel: 'chrome' })`) and mock the backend with `page.route('http://localhost:3123/api/**', …)`. Pitfalls met so far:
  - Use the full origin in the route pattern. A bare `**/api/**` also matches the Vite module `/_nuxt/generated/api/*.ts` and breaks the app.
  - `UAlert` has no `role="alert"`. Match on text.
  - Headless Chrome doesn't show the `beforeunload` dialog. Verify the guard by dispatching a cancelable `beforeunload` event and checking `defaultPrevented`.
  - Stopping the dev-server task can leave an orphaned Nuxt process holding the port and the lock ("Another Nuxt dev server is already running"). Kill it by port (`Get-NetTCPConnection -LocalPort 3123`) before restarting.
- **real-API:** `pnpm dev` (port 3000 is fine; the proxy rewrites `Origin`) and log in with a staff account.

## Environment notes

- Windows, pnpm 12. Bash (Git Bash) and PowerShell are both available. **Python is not installed.**
- `pnpm nuxt prepare` regenerates `.nuxt/`. Run it if lint or typecheck reports missing `.nuxt/*` files or new auto-imports aren't recognized.
