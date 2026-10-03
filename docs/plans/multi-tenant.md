# Multi-tenant plan (phase T)

_Status: T0 (this plan, D134), 2026-10-02. Owner: the app may be sold to other cafes as a
subscription (SaaS). Build it **SaaS-ready, not SaaS-complete**: the parts that are expensive to add
later now, sign-up and billing only once the commercial plan is confirmed._

## Purpose and scope

- **Purpose:** one deployment serves many cafe businesses (**tenants**). Each tenant has its own
  branches, menu, staff, customers' profiles, orders, payments settings, Telegram chats and reports,
  and never sees another's. We (the platform team, **super admins**) create and suspend tenants.
- **In scope (T1, T2):**
  1. Every tenant-owned row carries `tenant_id`; every query is scoped by the tenant from trusted
     server context; a test per feature proves tenant A can't read or change tenant B.
  2. Addresses with one domain: `/c/<slug>/…` for a tenant's customer site, admin and counter;
     `/platform/…` for super admins; sign-in pages and table QR links stay global.
  3. One login for the whole platform; a person can belong to several tenants (owner of one, staff
     at another, customer at a third).
  4. NUK Cafe becomes tenant #1 (`/c/nuk`) by a data migration; nothing else visible changes in T1.
  5. T2: the platform console (cafes, new cafe with its first owner, suspend/resume, change address),
     Choose a cafe and the cafe switcher, Cafe profile (name, logo), the not-found and paused pages,
     each tenant's own Bakong token.
- **Out of scope until the owner confirms the commercial plan (T3):** self sign-up and trials, plans
  and limits, subscription billing (manual KHQR invoices first), cafes' own domains, subdomains.

## Address scheme (one domain, D134)

```text
<host>/platform/…                   super admins (layout `platform`)       API /api/platform/**
<host>/sign-in, /sign-up, …         one login for everyone (as today)      Better Auth /api/auth/**
<host>/c/<slug>/                    the tenant's customer site (SSR)       API /api/c/<slug>/public/**, /shop/**
<host>/c/<slug>/admin/…             the tenant's owner and admins (SPA)    API /api/c/<slug>/admin/**
<host>/c/<slug>/counter/<branchId>  the tenant's cashiers (SPA)            API /api/c/<slug>/counter/<branchId>/**
<host>/table/<token>                table QR: global, finds the tenant from the token, redirects
<host>/                             redirects to /c/nuk for now; later the platform's landing page
```

- **The path names the tenant; the server decides access.** A Nitro middleware reads `<slug>` from
  `/api/c/<slug>/…`, loads the tenant (unknown → 404; suspended → 403 `TENANT_SUSPENDED`) and puts it
  on `event.context.tenant`. Access helpers then check the user's membership in **that** tenant. No
  route takes a tenant id from a body or query.
- **The app adds the prefix in one place:** `apiFetch` prefixes `/api/c/<slug>` for the tenant
  surfaces (`/admin`, `/counter`, `/public`, `/shop`), so feature code keeps calling
  `'/admin/menu/items'`. Page links go through one helper (`tenantPath('/admin/products')`); a lint
  rule flags hard-coded tenant paths. A later move to subdomains (`brown.example.com`) changes these
  two places, plus a redirect.
- **Slugs:** lowercase letters, digits and `-`, 3–40 characters, unique, a reserved list (`admin`,
  `api`, `platform`, `www`, `new`, `app`, …) for a later move to subdomains. Renaming keeps the old
  slug redirecting (`tenant_slugs` keeps every slug a tenant has had). Only super admins rename (T2).
- **Printed table QR codes** stay `/table/<token>`: the token is global, so a slug rename or a move
  to subdomains never breaks a printed code. Telegram buttons and emails build links with the same
  helper on the server.

## Identity (the spike, 2026-10-02)

**Finding:** Better Auth's `additionalFields` can only reference Better Auth's own models. Tried
on `organization` with `references: { model: 'menu_categories' }`: `nuxt prepare` fails with
`Model "menu_categories" not found in schema`. So a branch-organization can't carry a foreign key
to a `tenants` table of ours; integrity would rest on code alone.

**Decision: a Better Auth organization is a tenant (not a branch any more); branches become our
own table.** Our tables can reference `organization(id)` with real foreign keys (as `branch_hours`
does today), and Better Auth's membership is exactly a tenant membership.

| Level | Stored as | Roles | Today's equivalent |
|---|---|---|---|
| Platform | `user.role` (`admin` plugin) | `superadmin`; everyone else `customer` | the global `admin` role, which meant *the cafe's admin*; it goes away |
| Tenant | `member` (`organization` plugin), organization = tenant | `owner` (everything in the tenant: menu, settings, staff, payments, reports), `member` | `owner` = today's platform admin |
| Branch | `branch_staff (tenant_id, branch_id, user_id, role)`, our table | `manager`, `staff` (today's `branchRoles` access control, unchanged) | today's branch-organization membership |
| Customer | `customer_profiles (tenant_id, user_id, member_code)` | — | today's profile, now one per tenant |

- `organization` additional fields: `slug` is Better Auth's own (unique); we add `status`
  (`active`/`suspended`), `suspendedReason`, `logoAssetId`, `version`. The branch fields
  (`timezone`, `address`, `phone`, `currency`) move to `branches`.
- `branches (id, tenant_id → organization, name, timezone, currency, address, phone, status,
  version)`: existing branch ids are kept, so every `branch_id` value stays valid.
- `requireTenantPermission(event, perms)`: signed in, a member of the tenant on
  `event.context.tenant`, the tenant role grants it (owner: every tenant permission). Replaces
  `requirePermission` on `/admin`.
- `requireBranchPermission(event, branchId, perms)`: the branch belongs to this tenant (else 404),
  and the user is its owner or has a `branch_staff` row whose role grants it.
- `requirePlatformPermission(event, perms)`: `superadmin`; only on `/api/platform/**`.
- **A super admin is not a member of every tenant.** They see tenants and usage numbers (branches,
  staff, orders in 30 days, last order), never menus, orders or customers. Support access later via
  Better Auth's impersonation, time-limited and audited, after a support process exists.
- Better Auth's `activeOrganizationId` is not used: the path decides the tenant, so two tabs on two
  tenants never fight.

## Data model

Every tenant-owned table gets `tenant_id text not null references organization(id) on delete
restrict`, first in its main indexes (`(tenant_id, …)`). References between a tenant's own records
that cross features (an item's category, an order's branch, an order line's item) become composite
foreign keys `(tenant_id, x_id) → x(tenant_id, id)`, so the database refuses a link into another
tenant even if a query forgot its filter.

| Kind | Tables |
|---|---|
| Global (no `tenant_id`) | Better Auth: `user`, `session`, `account`, `verification`, `rate_limit`, `organization` (= tenant), `member`, `invitation`; `tenant_slugs` (slug → tenant, for redirects) |
| Tenant-owned (new) | `branches`, `branch_staff` |
| Tenant-owned (gets `tenant_id`) | `branch_hours`, `dining_tables`, `branch_item_states`; the 15 `menu_*` tables; `media_assets` (R2 keys under `t/<tenantId>/`); `customer_profiles` (member code unique per tenant); `orders`, `order_lines`, `order_events`, `counter_payments`, `khqr_settings`, `khqr_charges`, `exchange_rates`; `telegram_destinations`, `telegram_links`, `notification_rules`, `notification_deliveries`; `assistant_usage` (the daily limit per tenant); `sample_data_runs` |
| Shared, tenant nullable | `audit_events`, `outbox_messages` (null = a platform event); `idempotency_keys` (the scope includes the tenant) |

**Migration of existing data (T1.1, hand-written):** create the tenant organization "NUK Cafe"
(`nuk`); copy each branch-organization into `branches` with the same id; global `admin` users become
`owner` members of the tenant and `customer` on the platform; branch memberships become
`branch_staff` rows plus a `member` membership; the old branch organizations and their memberships
are removed; every tenant-owned table is rebuilt with `tenant_id` filled with the tenant's id
(SQLite can't add a `not null` column without a default, and a default would silently put a
forgotten row into NUK Cafe). Tested over linked rows in `server/tests/migrations.test.ts`.
**Needs verification on staging:** D1 ignores `PRAGMA foreign_keys = off`; table rebuilds use
`PRAGMA defer_foreign_keys = on`. Staging is backed up by Time Travel before the deploy.

## Rules every feature follows (added to the server standard in T1.1)

1. A repository function on tenant-owned data takes `tenantId` as a required argument and filters
   by it; the service gets it from the actor, the actor from `event.context.tenant`.
2. Not found and "another tenant's" are the same 404: nothing reveals another tenant's records.
3. Each feature's server tests seed **two tenants** and prove the other tenant's records can't be
   read, changed or linked to (each checked to fail with the tenant filter removed, as for other
   guards).
4. Scheduled tasks (unpaid-order expiry, outbox, closing summary, media purge, reminders) work per
   tenant; a suspended tenant's customer-facing work stops (no new orders), its expiry still runs.
5. Cross-tenant accounts: one person can be in several tenants, so a tenant's owner manages
   **memberships**, not accounts. Resetting a password or disabling sign-in (global effects) is
   allowed only for an account that belongs to this tenant alone and isn't a super admin; otherwise
   the owner can remove the person from the cafe, and they manage their own password.

## Phases and pull requests

Each PR leaves the app working. Until T1.5 the current tenant is **the only tenant** (resolved on
the server), so the API paths can stay while the columns arrive feature by feature.

| # | Step | Done when |
|---|---|---|
| T0 ✅ | This plan, D134, the spike, the frame prompts for T2 | Owner's review |
| T1.1 ✅ | Tenancy core (D135): organization = tenant (`status`, `version`), `branches`, `branch_staff`, the migration, `superadmin`, the access helpers, `requireTenant` (the only tenant for now), identity, branches and staff on it; **and `tenant_id` on every table that points at a branch, with the orders family** (they had to be rebuilt anyway: their foreign key moved from `organization` to `branches`). `tenant_slugs` waits for slug renames (T2) | Server tests incl. the migration over linked rows and two-tenant isolation for branches and staff; e2e unchanged |
| T1.2 ✅ | Menu and media: `tenant_id`, composite keys (`branch_item_states` → its variation too), R2 key prefix (D136, migration `0025_menu_tenants`) | Isolation tests (guard removed → fail) |
| T1.3 ✅ | Orders' reads scoped (their `tenant_id` exists since T1.1), customer profiles, KHQR settings, the riel rate (D137, migration `0026_tenant_settings`) | Isolation tests; race tests still pass |
| T1.4 | Telegram and notifications, reports, the assistant, sample data, audit, outbox, idempotency | Isolation tests |
| T1.5 | Addresses: `/c/<slug>` pages, `/api/c/<slug>` routes, the tenant middleware from the path, `apiFetch` prefix, `tenantPath`, the lint rule, browser storage keys per tenant, `/` and old paths redirect, `/table/<token>` global; the menu cache per tenant (test) | e2e on a seeded database with two cafes; the full suite; staging works at `/c/nuk` |
| T2 | (mockup round first: [frame prompts](#ui-frames-for-t2)) The platform console, Choose a cafe and the switcher, Cafe profile, not-found and paused pages, each tenant's Bakong token encrypted in the database (AES-GCM, the key a Worker secret) with its reminders | e2e; staging: create a second cafe and use it end to end |
| T3 | After the commercial plan is confirmed: self sign-up and trial, plans and limits, manual billing, then the rest | Owner's go |

After T1, the agreed customer features are built tenant-aware: **KHQR payment on the customer's
phone** and **the Telegram "your order is ready" message** (owner, 2026-10-02), then **the shop's
location and Directions** (maps step A).

## UI frames for T2

The owner generates frames with ChatGPT from the prompts given on 2026-10-02 (shared context, then:
Platform → Cafes; New cafe and its result; Cafe details with Suspend and Change web address; Choose a
cafe and the switcher; Admin → Cafe profile; Cafe not found and Ordering is paused), then the review
round of feature-standard.md. T1 has no new screens.

## Choices made, and open questions

- **[Choice] One login across cafes, a separate customer profile per cafe** (each cafe sees only its
  own customers). Alternative: separate accounts per cafe (stricter, but customers sign up again).
- **[Choice] Only super admins create tenants and rename slugs** until self sign-up (T3).
- **[Choice] A suspended cafe:** customers see "Ordering is paused"; staff can't use the admin or
  the counter; nothing is deleted; the expiry of unpaid orders still runs.
- **[Choice] Paths, not subdomains,** while the only address is `*.workers.dev` (no wildcard
  subdomains there). Subdomains or cafes' own domains later, on top.
- **[Open] QT1:** the platform's name (working name "NUK Platform") and, later, its domain. Blocks
  nothing in T1; T2's screens show it.
- **[Open] QT2:** the commercial plan (prices, trial, what a plan limits). Blocks T3 only.
