# Manager tools plan (D198)

_2026-10-23. Owner decisions (this session, the recommendations accepted, no mockup round): managers get their tools **in the counter app**, not the admin portal (which stays owners only, D52); **dining tables and QR codes** and **reports (view and print)** for their own branches; CSV and Send to Telegram stay with owners (`report: ['export']`); opening hours stay with owners (`settings: ['manage']`; a "pause orders" switch is a later idea); vouchers and points wait for phase 7 (D115)._

## Why the counter

The counter already knows each person's role at each branch (`GET /api/counter/me`), and every counter route checks it against the branch in the path (`requireBranchPermission`). The admin portal's sidebar, home page, search, assistant and about 95 routes assume an owner; opening it to managers would mean branch-filtering each, and one miss would leak another branch's or the whole cafe's data.

```text
Counter (signed in, role at this branch)
  └─ Manage (managers and owners; never staff)
       ├─ Tables & QR   /c/<slug>/counter/<branchId>/tables
       └─ Reports       /c/<slug>/counter/<branchId>/reports
                ↓
/api/c/<slug>/counter/<branchId>/…  requireBranchPermission(branch from the path)
  staff here → 403 · a manager of another branch → 404 · another cafe → 404
                ↓
branches and orders/reports services, the branch from the path, never the query or body
```

## Steps (one PR each)

1. **Server (D198, built).** Under `/api/c/<slug>/counter/<branchId>/`:
   - `tables` (`GET`, `POST`), `tables/{tableId}` (`PATCH`), `…/archive`, `…/restore`: `table: ['manage']`; `…/rotate-qr`: `table: ['rotateQr']`. The admin's table services, unchanged (labels, limits, versions, audit).
   - `reports/branches` (this branch only), `reports/summary`, `reports/items`, `reports/orders`: `report: ['read']`, the query validated with the path's `branchId` (`readValidQuery(event, schema, { branchId })`); `reports/orders/{orderId}`: `orderHistoryDetail(…, { branchId })`, another branch's order 404.
   - Tests: role grants (manager yes; staff 403; another branch 404; exporting isn't a branch action at all), every counter route checks the role at the path's branch and never a tenant permission, the tool routes' permissions and path branch, the detail's branch, the query override. Each guard removed fails a test.
2. **Counter UI (built).** **Manage** in the counter header (managers and owners, by the role at this branch from `GET /counter/me`): **Dining tables** (`/counter/<branchId>/tables`) and **Reports** (`/counter/<branchId>/reports/summary|items|orders`).
   - Each feature keeps its own screens and serves both places. Reports: a **surface** (`useReportSurface`: the API, query keys, page links, `exports`) that the counter's `CounterReportsPage` provides; the admin's is the default. The header shows Back to queue, the three reports as tabs and Print, never CSV or Telegram, and the Telegram destinations are never asked for. Tables: `BranchTablesTab` and `TableFormModal` take `surface: 'admin' | 'counter'` (a prop, since overlay modals render outside the page and can't inject); the counter's `CounterTablesPage` passes `counter`. Same cache for the same tables; mutation ids per surface.
   - Found and fixed: the report period button's name ("Period: 23 Oct 2026") didn't contain what it shows ("Today"), axe `label-content-name-mismatch`, on the admin's reports too. Its name is now "Today, period: 23 Oct 2026".
3. **Copy and docs (built).** The staff form's Manager description and the Staff help page say what managers get; the counter help page (step 2) and the security table (step 1) already do.

## Edge cases

- A person who is Manager at one branch and Staff at another sees Manage only at the first (the role comes from `GET /counter/me` per branch; the server checks it anyway).
- An owner opening the counter gets Manage at every branch (owners hold every branch permission).
- An archived branch: every counter route is 404 (`requireBranchPermission`).
- A report link with another branch in its query still reads the path's branch.
