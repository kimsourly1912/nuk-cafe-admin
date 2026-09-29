# Branch settings and dining tables plan (step 5.1)

_2026-09-29. Owner decisions (this session): edit existing branches only (no create or archive; the seed task creates branches); opening hours are several windows a day and may run past midnight; closures (holidays, "pause orders") are deferred to ordering (phase 6); a table's QR can be viewed again at any time (rebuildable token); a table has an optional area. UI reference: the owner's two mockups (Branch → Settings / Dining tables tabs), for layout and content only (D74). Decision record: D91._

Two PRs: **5.1a** the server (this plan, contracts, migration, service, routes, tests), **5.1b** the admin pages.

## Purpose and scope
- Purpose: an admin keeps each branch's customer-facing details and opening hours, and manages its dining tables and their QR codes (printed on each table; a customer scans it to order for that table, steps 5.3 and 6.2).
- In scope / acceptance criteria:
  1. Read a branch's settings: name, timezone, address, phone, weekly hours, `version`, and whether it's open now (in its timezone) with today's weekday there.
  2. Update them in one save from the version read (stale: 409); an unknown timezone, overlapping windows or a blank name are refused on their field; audited.
  3. Hours: 0 to 21 windows a week (three a day), each on a weekday, minutes after midnight, ending past midnight allowed, never overlapping (the Availability rules' shape and checks, shared, D63).
  4. Tables of a branch: list (active, archived or all), create (label, optional area), rename / change area, archive, restore, rotate QR; labels unique among a branch's active tables (case-insensitive); at most 200 tables per branch.
  5. Each active table has a QR URL (`<site>/table/<token>`) the admin can show again at any time; rotating makes a new one and the old one stops working; an archived table's QR doesn't work (and isn't shown).
  6. Public: `GET /api/public/tables/{token}` resolves a token to its branch and table; unknown tokens, archived tables and archived branches are all 404.
- Out of scope: creating or archiving branches; closures and "pause orders" (phase 6); the counter surface's table routes for managers (with the counter screen); the customer page behind the QR URL (5.2/5.3).

## API contract (`shared/contracts/branches.ts`)
- `GET /api/admin/branches/options` (exists): active branches for pickers and the Branch page's switcher.
- `GET /api/admin/branches/{branchId}` → `BranchSettings`: `branch: ['read']`.
- `PATCH /api/admin/branches/{branchId}` `{ version, name?, timezone?, address?, phone?, hours? }` → `BranchSettings`: `branch: ['update']`, plus `settings: ['manage']` when `hours` is sent (security.md: branch hours are a setting). Absent keeps, `null` clears address/phone, `hours` replaces the whole week.
- `GET /api/admin/branches/{branchId}/tables?status=active|archived|all` (default active) → `DiningTable[]` by label (natural order: "Table 2" before "Table 10").
- `POST …/tables` `{ label, area }` → `DiningTable`; `PATCH …/tables/{tableId}` `{ version, label?, area? }`; `POST …/tables/{tableId}/archive|restore|rotate-qr` `{ version }`: all `branch: ['update']` (admin surface: admins only; managers get the counter routes later).
- `GET /api/public/tables/{token}` → `{ branch: { id, name }, table: { id, label } }`.
- `DiningTable`: `id, branchId, label, area, status, qrUrl (null when archived), qrRotatedAt, version, createdAt, updatedAt`.

## Rules the server enforces
- **[Choice] QR token:** `token = base64url(HMAC-SHA256(NUXT_QR_SECRET, "<tableId>:<qrVersion>"))`, cut to 128 bits (22 characters). Only `SHA-256(token)` is stored (unique), so a leaked database reveals no working QR; the server rebuilds the token from the secret to show it again (owner, D91). Rotating increments `qr_version`. Changing the secret invalidates every printed QR (operations.md).
- **[Choice]** A production build without `NUXT_QR_SECRET` refuses the table routes (500 `QR_NOT_CONFIGURED`); the dev server uses a fixed local secret (`branches.qr.ts`).
- **[Choice]** Label: 1–20 characters, trimmed; area: up to 40, blank = none. Name: 1–60. Address: up to 200; phone: up to 30. Timezone: any IANA zone the runtime knows.
- A branch with no hours is never open (orders need it open, D45); the admin page warns.
- Branch writes: one batch with a version guard on the branch (`version`, new) and the audit event; hours replaced in the same batch.

## Screens (5.1b; the mockups)
- Sidebar **Branch** → `/branches`: opens the only branch at once, or lists them when there are several (staging has a second test branch). `/branches/[id]` with **Settings** and **Dining tables** tabs. **[Choice]** The tab is local state (`?tab=tables` opens that one): a tab in the URL would make each switch a route change, which the unsaved-changes guard asks about while the settings draft has changes. Both tabs stay mounted, so the draft survives a switch.
- Settings (settings blueprint: one draft, one Save): status cards (Open now / Closed now, timezone, today's hours), Branch information (name, address, phone, timezone), Weekly hours (a row per day: open switch, windows, Add window; Copy Monday to weekdays, Copy Saturday to weekend).
- Dining tables: search, Active/Archived tabs with counts, cards (QR thumbnail, label, area, status, View QR, Rotate, ⋮ Rename / Archive / Restore), New table; View QR dialog with the link (copy), Download SVG and Download PNG (print from the file; a Print button is left out: printing a generated page runs into the CSP, D48); "New QR" confirms that the printed QR stops working, then shows the new one. **[Choice]** On phones the three status cards become one card with a row each.

## Edge cases and verification
- Stale version on settings and tables (409), checked to fail with the guard removed; overlapping and overnight hours; unknown timezone; duplicate label (and restoring into a taken label); rotate invalidates the old token; archived table and archived branch tokens 404; deterministic token (same secret, table and version → same token; another secret → another); the 200-table cap; D1's 100-parameter limit on the hours insert (21 windows × 4 columns). Server tests in `server/features/branches/tests/`; e2e in 5.1b.
