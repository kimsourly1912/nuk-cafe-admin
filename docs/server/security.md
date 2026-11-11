# Security & hardening

← [Server standard](./README.md)

- [What the libraries do](#what-the-libraries-do)
- [Identity](#identity)
- [Roles and permissions](#roles-and-permissions)
- [Sessions](#sessions)
- [Staff onboarding](#staff-onboarding)
- [Customers](#customers)
- [Request protection](#request-protection): CSRF, headers, rate limits, size limits
- [Uploads](#uploads)
- [Secrets](#secrets)
- [Logging and privacy](#logging-and-privacy)
- [Checklist for every route](#checklist-for-every-route)

---

## What the libraries do

Use these; don't rebuild them. Checked against better-auth 1.7.3, @nuxtjs/better-auth 0.3.5, @nuxthub/core 0.10.8.

| Need | Use |
|---|---|
| Accounts, passwords, sessions, cookies | Better Auth `emailAndPassword` |
| Email verification, password reset | Better Auth `emailVerification` / `sendResetPassword`, delivered with Cloudflare Email Sending (D212) |
| Two-step sign-in (TOTP and backup codes; required for super admins, D188) | Better Auth **`twoFactor`** plugin |
| Platform role, the ban fields and the banned-sign-in check (an expired ban lifted at sign-in) | Better Auth **`admin`** plugin; its endpoints granted to nobody, the console writes bans in our own batch (D187) |
| Branches, branch staff and their roles | Better Auth **`organization`** plugin (a branch is an organization) |
| Permission checks | Better Auth **access control** (`createAccessControl`) + `userHasPermission` / `hasPermission` |
| Rate limiting of auth routes | Better Auth `rateLimit` (database storage, `customRules`) |
| Breached passwords | Better Auth **`haveIBeenPwned`** plugin |
| Work on sign-up (create the loyalty account) | Better Auth `databaseHooks.user.create.after` |
| Session required on route groups | `@nuxtjs/better-auth` `routeRules` `auth` in `nuxt.config.ts`: `/api/admin/**`, `/api/counter/**` and `/api/shop/**` need a session. A second line only (see Checking): who may use the admin is a role in the tenant (D135), which the gate can't see, so `server/tests/admin-routes.test.ts` checks every admin route calls an access helper |
| Upload size and type check | NuxtHub `ensureBlob(file, { maxSize, types })` (plus our magic-byte check: it trusts the claimed type) |
| Rate limiting our API, bot protection | Workers rate-limit bindings on `/api/public/**` and placing orders per client address (D121, D156, no domain needed); Cloudflare WAF rate-limiting rules (edge, no code) once a domain exists |
| Security headers | Nitro `routeRules` `headers` (production builds, `securityHeaders()` in `nuxt.config.ts`) |
| Backups | D1 Time Travel |

**Don't use:** NuxtHub `blob.handleUpload` (stores under the client's file name and turns validation failures into 500s), and Better Auth impersonation (off until there's a support process for it).

## Identity

- **One account per person**, email + password, owned by Better Auth (`user`, `account`, `session`, `verification`).
- An account by itself grants **nothing** beyond the shop: access comes from its memberships in a tenant (a cafe business, D134, D135) and the branches it works at. **One account can belong to several tenants** (owner of one, staff at another, customer at a third); each tenant's access is separate.
- The same person can be staff and a customer on one account. **Staff never act on their own customer records**: no redeeming their own voucher, adjusting their own points or completing their own order payment. The server checks `actor.userId !== customer.userId` for those actions.

## Roles and permissions

Three layers (D134, D135):

| Layer | Stored in | Roles |
|---|---|---|
| Platform | `user.role` (Better Auth `admin` plugin) | `customer` (default for every sign-up), `superadmin` (the platform team: tenants, never a tenant's data) |
| Tenant | `member.role` (Better Auth `organization` plugin, an organization = a tenant), one row per tenant | `owner` (everything in the cafe; shown as "Admin" in the app), `member` (only their branches) |
| Branch | `branch_staff.role` (our table), one row per branch | `manager`, `staff` |

Permissions are **statements** (`resource: [actions]`) defined once in `server/features/identity/identity.permissions.ts` with `createAccessControl`, and granted to roles there. Agreed with the owner on 2026-09-27 (D45):

| Resource | Action | owner | manager | staff |
|---|---|:-:|:-:|:-:|
| menu | read | ✔ | ✔ | ✔ |
| menu | write / publish | ✔ | | |
| menu | set sold out (own branch) | ✔ | ✔ | ✔ |
| media | upload | ✔ | | |
| branch | create (at most 10 active per cafe, D197) / read / update | ✔ | read | read |
| furniture | manage: the cafe's own table, chair and fixture looks for the shop designer (tenant permission, D273; chairs and fixtures since step 3d; a support visit lists them, QS3) | ✔ | | |
| branch | pause and resume online orders (on the counter, D199) | ✔ | ✔ | |
| staff | list, create / change role / disable | ✔ | | |
| table | manage, rotate QR (managers on the counter, D198) | ✔ | ✔ | |
| order | read queue, ready, complete (payment starts preparation: no accept step) | ✔ | ✔ | ✔ |
| order | cancel | ✔ | ✔ | ✔ |
| payment | collect | ✔ | ✔ | ✔ |
| payment | refund | ✔ | | |
| payment | review: KHQR payments an order couldn't take, record their return (tenant permission, D266; never a support visit) | ✔ | | |
| voucher | look up, redeem | ✔ | ✔ | ✔ |
| voucher | issue to a customer | ✔ | ✔ | |
| voucher template | manage | ✔ | | |
| settings | KHR exchange rate, branch hours | ✔ | | |
| loyalty | adjust points | ✔ | ✔ | |
| report | read, export (the reports, their CSV and print, and sending them to Telegram; 8.1, D110) | ✔ | read, own branch (on the counter, D198; no CSV or Telegram) | |
| audit | read | ✔ | own branch | |
| assistant | use the AI assistant (phase 9, D107, D108) | ✔ | | |
| Better Auth `organization` / `member` / `invitation` / `ac` endpoints | update, delete, add or remove members, invite | | | |

The platform role grants only `tenant` (create, read, update, suspend; the platform console, T2), `account` (read, ban, sign-out, reset-password; the console's Accounts, P1, D187), `owner` (add, remove, transfer: a cafe's ownership, P2, D189) and `notes` (update: the platform's internal notes about a cafe, D189) `activity` (read: the console's Activity, the platform's own audit rows by action, D191) and `health` (read: System health, counts and dates, never a secret, D192) and `support` (open: a cafe its owner allowed support for, D193) to `superadmin`, and **nothing inside a tenant**. No role gets Better Auth's `user` / `session` admin endpoints (D187): they would write without our audit row or version guard, so accounts change only through `/api/platform/accounts/**`; impersonation stays off until there is a support process (QP1). The last row is Better Auth's own statements: no tenant role gets them, so nobody adds members or changes a tenant through Better Auth's endpoints; staff changes go through our admin routes. `server/features/identity/tests/identity.permissions.test.ts` asserts these tables, one row per grant.

A tenant's `owner` has every branch permission in every branch of that tenant: **our** `requireBranchPermission` grants that.

**Checking** (`server/utils/access.ts`, auto-imported in routes; the decisions are `authorize*` in `server/features/identity/identity.service.ts`):

| Helper | Surface | Refuses with |
|---|---|---|
| `requireTenant(event)` | public routes; called by the others | 404 when there is no tenant or it's suspended. The tenant is the request's, never anything the client sends: until addresses name it (`/api/c/<slug>`, T1.5) it's the only tenant |
| `requirePermission(event, { menu: ['write'] })` | `/api/admin` | 401 no session / banned; 403 `PASSWORD_CHANGE_REQUIRED`; 403 `FORBIDDEN` when the caller's role **in this tenant** lacks any requested action (a super admin, another tenant's owner and a `member` included) |
| `requireBranchPermission(event, branchId, { order: ['cancel'] })` | `/api/counter/{branchId}` | 401; 403 `PASSWORD_CHANGE_REQUIRED`; **404** for an unknown or archived branch, **another tenant's branch**, a branch the caller doesn't work at, or an unknown role; 403 `FORBIDDEN` for staff whose role lacks the action. The tenant's owners pass in every active branch of the tenant |
| `requireCustomer(event)` | `/api/shop` writes | 401; 403 `PASSWORD_CHANGE_REQUIRED` (a guest passes, D156) |
| `requireSignedIn(event)` | own-account reads | 401; 403 `PASSWORD_CHANGE_REQUIRED` |
| `requirePlatformPermission(event, { tenant: ['create'] })` | `/api/platform` (D142) | 401; 403 `PASSWORD_CHANGE_REQUIRED`; 403 `FORBIDDEN` unless the account is a `superadmin` whose role grants the action; then 403 `TWO_FACTOR_REQUIRED` until two-step sign-in is on (D188). No tenant: the console acts on cafes by id and never reads their data. `GET /api/platform/me` uses `platformSession` (answers on a temporary password or without two-step sign-in, with `mustChangePassword` / `twoFactorEnabled`; 403 `NOT_PLATFORM_ADMIN` for everyone else) |

- Each returns the **actor** (`{ userId, tenantId, role }`, plus `branchId` and `branchRole?` on the counter) that services receive: they scope every read and write to `actor.tenantId` and write it to the audit log.
- The branch id comes from the path (`readIdParam(event, 'branchId', 'The branch')`), never from a body. Better Auth's tables use UUID v7 like ours (`advanced.database.generateId`), so `readIdParam` applies to users and tenants too.
- Deny by default: a route without a permission check is a bug. The `routeRules` session gate only asks for a session (401); it can't see tenants, roles, branches, `mustChangePassword` or email verification. `server/tests/admin-routes.test.ts` fails when an admin route calls no access helper.
- Tests: `identity.service.test.ts` covers every refusal above (each guard checked to fail its test when removed). The route wiring was checked against a production build with temporary probe routes (D48); per-route tests come with the first real routes (step 1.4).
- Only super admins can create tenants (`allowUserToCreateOrganization: user => user.role === 'superadmin'`); Better Auth makes the creator its `owner` (`creatorRole`). The seed task and the platform console (T2) create them directly.
- Tenants are never deleted (`disableOrganizationDeletion`); they're suspended through `organization.status`. Branches are our own table, archived through `branches.status`.
- **Every query on tenant-owned data names the tenant** (the plan's rules): a repository takes `tenantId`, and another tenant's record is the same 404 as a missing one. Each feature's tests seed two tenants and check this, with the filter removed to see them fail.
- The whole configuration is `identityAuthOptions()` in `server/features/identity/identity.auth.ts`; `server/auth.config.ts` only passes it the site URL.

## Two-step sign-in (D188)

- Better Auth's `twoFactor` plugin: an authenticator app's 6-digit code (TOTP, issuer "Angder" (D232; entries added before it keep "NUK Platform" and still work)) or one of ten backup codes, after the password or Google (D262). Its secret and backup codes are stored encrypted (`two_factor`, migration `0041_two_factor`).
- **Required for super admins:** `authorizePlatform` refuses 403 `TWO_FACTOR_REQUIRED` until `user.two_factor_enabled`; the console's only page is then `/platform/two-factor` (password, QR code or key, backup codes shown once, a code from the app).
- It belongs to the **account**: every sign-in (the console, a cafe's admin and counter, the customer account) answers a password with `twoFactorRedirect`; Google callbacks use the same native challenge and return bounded `googleTwoFactor=1` metadata (D262) and a 10-minute challenge cookie, and shows the shared `<TwoFactorCodeForm>`; 5 wrong codes end the challenge, 10 across challenges lock the account for 15 minutes (Better Auth's defaults). No "trust this device".
- Turning it on signs the account out on its other devices (`identity.auth.ts`, after-hook on `/two-factor/verify-totp`): a session made with the password alone must not count as two-step.
- **Owners and staff** may turn it on and off themselves on the account security page (D242), never required at the counter. **A super admin can't turn it off** (`/two-factor/disable` refused 403 `TWO_FACTOR_REQUIRED` by `identity.auth.ts`'s before-hook). Staff shows each person's status (`StaffMember.twoFactorEnabled`, own cafe only); owners can't change someone else's: one account can work at several cafes.
- A super admin who lost the app and the backup codes is reset by hand ([operations → Super admins](operations.md)).
- **An owner, staff member or customer who lost both (QA1, D245, D247):** the console's account page, **Turn off two-step sign-in** (permission `account: ['two-factor-off']`, super admins only; never a cafe owner, since one account can work at several cafes). It needs a reason (how the team checked it's really them) and the super admin's own password (`requireConfirmation`, D246). One batch, as Better Auth's own disable leaves it: `user.two_factor_enabled` off with the version and "still on" guards, the account's `two_factor` row deleted, every session deleted, the audit row `platform.account.two-factor.off` (shown in Activity). Never one's own account or another super admin's.
- Limit: a guest's orders move to an account at sign-in by Better Auth's anonymous plugin, which runs on the password step; with two-step sign-in that step makes no session, so they don't move. Accounts with 2FA are affected, including the D262 Google challenge; this is an existing transfer limitation.

## Sessions

- Better Auth database sessions, HttpOnly + `Secure` (production) + `SameSite=Lax` cookie, one origin.
- Lifetime: **7 days** for a customer, refreshed daily while used (Better Auth; D45). **A workspace (a cafe's admin and counter, the platform console) takes a session for a day from sign-in, never renewed** (D243): `workspaceSession` in `server/utils/access.ts` deletes an older one and answers 401 `SESSION_EXPIRED`; every admin, counter and console route reads the session through it (`routes.test.ts`). Better Auth's own renewal can't keep a shorter absolute limit (verified in D243).
- **Your devices** (D243): `GET /api/me/sessions` lists the account's own live sessions without tokens; signing the others out is Better Auth's `/revoke-other-sessions`. Better Auth's `/list-sessions` returns tokens and isn't used.
- **Revoke all sessions** of a user when their role changes, they're removed from a branch, their staff access is disabled, or they're banned (`admin.revokeUserSessions`).
- `trustedOrigins` is the origin of `NUXT_PUBLIC_SITE_URL` (the module adds localhost origins in dev only). The origin check on our routes (`server/middleware/10.origin-check.ts`) accepts the same origin.

## Re-confirming dangerous changes (D246)

Like GitHub's sudo mode: a stolen signed-in session (an unlocked phone, a copied cookie) can read a workspace but can't make these changes without the account's password.

| Change | Route | Asks when |
|---|---|---|
| Where the cafe's payments go | `PUT …/admin/khqr`, `PUT`/`DELETE …/admin/khqr/token` | always |
| Admin access | `POST …/admin/staff` | it gives admin |
| | `PATCH …/admin/staff/{userId}` | it gives admin to someone who isn't one (`updateStaffAccess`'s `confirmAdminGrant`; its default refuses, so a caller can't forget it) |
| A cafe's owners (console) | `POST /api/platform/tenants/{id}/owners`, `…/owners/{userId}/remove`, `…/transfer` | always |

- **Check:** `requireConfirmation(event)` (`server/utils/access.ts`), **after** the route's permission check: this session's `session.confirmed_at` is less than 15 minutes old, or 403 `CONFIRMATION_REQUIRED`. `routes.test.ts` fails a listed route without it, or with it before the permission check.
- **Confirming:** `POST /api/me/confirm` `{ password }`, checked by Better Auth's `verifyPassword` against this session. Password confirmation remains required even after Google sign-in (D262). A Google-only account must set a password through the existing recovery-email flow before a password-confirmed action. Rate limited per address (`RATE_LIMIT_ACCOUNT`, like deleting an account).
- **Per session:** kept on the session row, so it ends at sign-out and never counts for another device or account.
- **Wrong passwords:** 400 beside the field, audited (`identity.confirm.failed`), counted on the session (`confirm_failures`); the 5th in a row deletes that session (401). Counted per session, so a stranger's guesses on a stolen session never sign out the owner's other devices.
- **App:** `apiFetch` answers `CONFIRMATION_REQUIRED` with `<ConfirmIdentityModal>` ("Confirm it's you") and sends the same request **once** more (same body, version and idempotency key). Cancel: nothing is sent again, silently. One dialog at a time; a session change closes it.
- **Not covered (by design):** a super admin on a support visit is read-only already (D193); creating a new cafe with its first owner (no existing cafe is at risk).

D267 makes the confirmation attempt limit atomic: reserve one of five per-session slots before checking a password, so parallel requests cannot share the last slot. In-flight and interrupted checks consume slots conservatively until a successful confirmation resets them. A failed check audits and conditionally revokes the session in one batch at the limit. Success guards the still-live session; revocation during verification cannot return a successful confirmation. The existing per-address rate limit remains an additional control. Tests: `identity/tests/confirmation.service.test.ts` covers parallel failures, device isolation and revocation during verification.

## Staff onboarding

**What an owner sees of their staff (D248):** name, email, access, two-step on or off (D242), and **Last active here**: when the person last opened *this* cafe's admin or counter (`workspace_visits`). Not the account's sign-in time: an account is the platform's and works at several cafes, so it would show one cafe's owner when the person was at another. Two-cafe test: `visits.service.test.ts`.

Built in step 1.4 (D49): `server/features/identity/staff.*`, routes under `/api/admin/staff`.

1. An admin creates the account with name, email and access: `admin` and/or one role per branch (several branches allowed). The server generates a **temporary password** (16 characters, e.g. `Hq7x-3mPa-kR9t-Wz2c`), returns it **once** for the admin to hand over, and stores only Better Auth's hash. The email is marked verified (the admin vouches for it).
2. The account carries `mustChangePassword = true` (a Better Auth `user.additionalFields` field).
3. While it's set, our access helpers answer **403 `PASSWORD_CHANGE_REQUIRED`** on every surface; Better Auth's `/api/auth/**` still works, and the app shows the change-password screen (step 1.7). Signing in on the customer site instead keeps the session and links to the account's workspace change-password page (Q3, D241); the store counts it as signed out meanwhile.
4. Changing the password (Better Auth `/change-password`) clears the flag: an `after` hook in `identity.auth.ts`, only when the change succeeded. A reset link clears it too (the token's user is read in a `before` hook, since the token is gone afterwards). A password set by an admin stays temporary.
5. **Reset by an admin** (step 10.1, D115): `POST /api/admin/staff/{userId}/reset-password` `{ version }` (`staff: ['reset-password']`, admins only) gives a staff member a new temporary password, returned **once**, sets `mustChangePassword`, and deletes every session of theirs, in one batch guarded by the account's version, with an audit entry (never the password). Not for one's own account (Change password) and not for customers (they reset by email).
6. Changing someone's access replaces their role in the tenant (`owner` = "Admin", or `member`) and their branches, and **signs them out everywhere** (except an owner editing their own branches). Disabling removes them from the tenant (membership and branches) and signs them out. Their account keeps working as a customer, **and keeps any other cafe's access** (D135); it can be given access again later.
7. **Tenants (D135):** an owner manages the people of their own tenant only: another tenant's people are 404 to every staff route, and the list shows only members. The last-owner guard counts this tenant's owners. A password reset changes the account everywhere, so it's refused with 409 `STAFF_ELSEWHERE` for someone who also belongs to another tenant, or a super admin: they reset it themselves.
8. Every change writes an `audit_events` row (`staff.create`, `staff.access.update`, `staff.disable`) with the access given, never a password.

| Case | Result |
|---|---|
| The email already has a **customer** account, or works at **another cafe** | That account gets the access; its password, points, orders and other cafes' access are untouched; no temporary password (`temporaryPassword: null`) |
| The email already has **staff access here** (or is an owner here) | 409 `STAFF_ALREADY_EXISTS`: edit them instead |
| A membership names an unknown or archived branch | 400 `VALIDATION_FAILED`, `fieldErrors["memberships.N.branchId"]` |
| No admin role and no membership | 400 (`fieldErrors.memberships`); taking all access away is "disable" |
| An admin removes their own admin role, or disables themselves | 409 `OWN_ACCESS` |
| Two admins demote each other at the same moment | The batch guard keeps at least one active admin: the second save gets 409 `LAST_ADMIN` |
| Two saves of the same version | One wins; the other gets 409 `VERSION_CONFLICT` (`version` = the account's `updated_at` in ms) |

| Route | Permission | Returns |
|---|---|---|
| `GET /api/admin/staff?page&pageSize&search&branchId&role` | `staff:read` | `Page<StaffMember>`: accounts with access only, by name; `role` = `admin` \| `manager` \| `staff` |
| `GET /api/admin/staff/{userId}` | `staff:read` | `StaffMember` |
| `POST /api/admin/staff` | `staff:create` | 201 `{ staff, temporaryPassword }` |
| `PATCH /api/admin/staff/{userId}` | `staff:update` | `StaffMember`; body `{ version, admin, memberships }` replaces all access |
| `POST /api/admin/staff/{userId}/disable` | `staff:disable` | 204; body `{ version }` |

Contracts: `shared/contracts/staff.ts`. The account rows are written by our repository, not `auth.api.createUser` / `addMember`, so the account, its memberships, its sessions and the audit row change in **one atomic batch** (D1 has no transactions); the password hash is Better Auth's own `hashPassword`, and a test signs in through Better Auth with the result.

**Verified in the auth spike (2026-09-27, better-auth 1.7.3, in-memory adapter, 17 checks):**
- The seed task can call `auth.api.createUser` **without a session** (server-side) with `role: 'admin'` and `emailVerified: true`.
- An admin's `createUser` sets `emailVerified` and `mustChangePassword` (still true with the field `input: false`, which makes Better Auth **drop** it from a sign-up rather than refuse the request; `identity.auth.test.ts`); new users get the platform role `customer`. Staff stay `customer` on the platform and get their access from branch membership.
- `requireEmailVerification` refuses an unverified customer's sign-in (403).
- `allowUserToCreateOrganization` stops non-admins from creating branches; `organization.additionalFields` stores `timezone`.
- `addMember` (server-side) assigns `staff`; `hasPermission` with an explicit `organizationId` grants `order:cancel`, refuses `payment:refund`, and **throws "not a member"** for another branch (our helper turns that into 404).
- **Better Auth does not enforce `mustChangePassword`:** our access helpers must refuse with `PASSWORD_CHANGE_REQUIRED`, and the change-password route clears the flag server-side after `changePassword` succeeds.
- `removeMember` + `revokeUserSessions` end a staff member's access immediately.
- `@nuxtjs/better-auth` generates every plugin table and field (`role`, `banned`, `must_change_password`, `impersonated_by`, `active_organization_id`, `organization.timezone`, `member`, `invitation`) into the schema NuxtHub migrates.

## Customers

Built in step 1.6 (D51).

- Sign-up with email + password (`haveIBeenPwned` rejects breached passwords). A verification email is sent on sign-up (link valid 24 h; following it signs the person in).
- **Ordering needs no account and no verified email (D156, replacing D45's rule):** customers pay at the counter before anything is made, so an order proves nothing an email would. `/api/shop/**` writes (`requireCustomer`) take any signed-in user, a guest included. The verification email still matters for getting back into an account (a password reset).
- **Guests (D156):** Place order without an account signs the browser in through Better Auth's **anonymous plugin**: a `user` row with `is_anonymous`, a placeholder email, no password, a normal session cookie. So "only your own orders" holds unchanged (orders keep their `customer_id`). A guest is a `customer` in every tenant and **never a member** (`authorizeSignedIn` returns before reading memberships), so never staff; gets no customer profile or member code; names themselves for the counter (`guestName`, required from a guest; stored in the order's batch by a statement that only renames `is_anonymous` users). Signing in or up on the same browser moves the guest's orders to the account (`onLinkAccount` → `moveGuestOrders`); the guest row stays (orders' `restrict` keys), empty. A guest who clears the browser loses access to their orders (the counter still has them).
- Browsing the menu works without an account; `GET /api/shop/me` answers `{ guest: true, name }` for a guest, the account otherwise.
- **Workspace links are hints, not access (D124):** `GET /api/shop/me` lists the staff `workspaces` (`admin`, `counter`) the account may open, worked out on the server like `/api/admin/me` and `/api/counter/me`, so the store's account menu can link there. The admin and counter routes still check every request themselves.
- Password reset by email: the link works **once** and expires after **1 hour**; a reset **signs the account out everywhere** and clears a temporary password. A reset request answers the same whether or not the email has an account (the only difference is one outbox insert, a few milliseconds).
- Account emails go through the **outbox** (platform feature): Better Auth's callbacks only queue a message, and `platform:deliver-outbox` sends it within a minute, with retries. The link is in the message until it's sent, then dropped from the row.
- An account has a **customer profile** with a member code in each cafe it uses, made on first use there (`ensureProfile` on `/api/c/<slug>/shop/me`) or in the staff-creation batch. Never at sign-up (D221): an account is the platform's and sign-up names no cafe, so a profile there went to the oldest cafe. The platform's account pages read Better Auth's session only, never a cafe's `/shop/me`. Opening a cafe's menu signed in makes a profile there; when loyalty or a customer list shows profiles to a cafe (step 7.1), joining must be the customer's explicit choice. The loyalty account joins in step 7.1.

| Case | Result |
|---|---|
| Unverified customer places an order | Allowed (D156) |
| A guest places an order without a name | 400 `VALIDATION_FAILED` (`guestName`) |
| An account sends `guestName` | Ignored: only a guest is renamed |
| A guest calls an admin or counter route | 403 / 404 like any customer: never a member |
| A guest signs in or up on the same browser | Their orders move to the account |
| Reset link used twice | Second use: 400 `INVALID_TOKEN` (Better Auth) |
| Reset requested for an unknown email | Same 200 answer, no email |
| Staff on a temporary password resets by email | Flag cleared, like changing it |
| An account signs up (any cafe count, none included) | No profile anywhere; each cafe's on first use there (D221) |
- **Support access** (P5, D193): a cafe's owner allows the platform team to look for 24 hours (`support: ['grant']`, owners only); a super admin opens a visit with a fresh authenticator code (5 wrong codes per 15 minutes at most), bound to that session, an hour at most. During it `requirePermission`, after refusing, lets the super admin **read only**: GET requests for `menu:read`, `branch:read|update`, `staff:read`, `report:read`, `settings:manage`, `furniture:manage` (lists looks only), `audit:read` (never exports, the assistant, uploads or sample data); any other method is 403 `SUPPORT_READ_ONLY`. Every request is audited (`support.request`). Not Better Auth's impersonation, which stays off.
- A super admin can **add, remove or transfer a cafe's ownership** from the console (P2, D189), alone and with a required reason in the audit row (D186): one batch with the cafe's version, the accounts' versions and eligibility, and `requireAnOwner` (an owner who can sign in always stays; 409 `LAST_OWNER`). A removed owner keeps only their branch roles and is signed out everywhere. Never one's own ownership (409 `OWN_ACCOUNT`); another super admin may be made an owner (QT4, D190). The console's internal notes about a cafe live in `tenant_notes`, never on `organization` (Better Auth would answer its fields to the cafe's members).
- A super admin can **ban** an abusive account from the platform console (P1, D187): a reason and an optional end, every session deleted and the audit row in the same batch; Better Auth's sign-in hook refuses a banned account and lifts an expired ban. Never a super admin's account or one's own.

## Request protection

| Protection | Rule |
|---|---|
| **Better Auth endpoints** | Over HTTP, only the `/api/auth/**` endpoints our pages and emails use answer; every other one is 404 (D272, `server/features/identity/auth-endpoints.ts`). The `organization` and `admin` plugins' endpoints are closed this way, not only by permissions: `/organization/update-member-role` skips them for owners. Server code calls `auth.api.*` directly and is unaffected. A new page needing an endpoint adds it to `AUTH_HTTP_ENDPOINTS` after reading that endpoint's own checks in the installed version. |
| **CSRF** | Every non-GET request to `/api/**` except `/api/auth/**` (Better Auth checks its own) and `/api/webhooks/**` must carry an `Origin` (or `Referer`) in `trustedOrigins`. Otherwise 403. `GET` never changes state. |
| **Webhooks** | `/api/webhooks/telegram` (D112) is called by Telegram, not a browser: no session, no origin check. It compares `X-Telegram-Bot-Api-Secret-Token` with `NUXT_TELEGRAM_WEBHOOK_SECRET` in constant time before reading the body (401 otherwise). What it can do is narrow: connect a chat with a valid one-time code (a group only from one of its admins, and only after a portal admin confirms), mark a chat blocked, follow a supergroup's new id. |
| **Headers** | Production builds, every route: `Content-Security-Policy` (`default-src 'self'`; scripts and styles also `'unsafe-inline'` pending a separate nonce/hash policy compatible with SSR caching; images `'self' data: blob:`; `connect-src 'self' blob:` (`blob:` since D274: three.js reads a 3D model's embedded textures through a `blob:` URL the page made; it reaches no other origin); `object-src 'none'`; `base-uri` and `form-action 'self'`; `frame-ancestors 'none'`), `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin` (D216: origin only, even same-origin, so token paths such as `/table/<token>` never travel as a referrer), `Cross-Origin-Opener-Policy: same-origin-allow-popups` (D261 follow-up, 2026-11-05: a menu/workspace document retains its policy when the router enters Google sign-in; apply the compatible policy across app documents without forced reloads. This permits outgoing OAuth popup references while retaining isolation from cross-origin openers and same-origin read restrictions. The passive `/google-callback` keeps `unsafe-none` and no-store), `Permissions-Policy` denying camera, microphone, geolocation and payment (loosen camera if QR scanning needs it). Exception (D275 step E4): a cafe's menu document (`/c/<slug>`, from which Explore opens in the same document) and Explore's (`/c/<slug>/explore`) send `geolocation=(self)`, so Explore nearby can ask on a tap; frames stay denied, the browser asks the customer, and the position never leaves the browser. Explore entered from another document (checkout loaded directly, for example) keeps that document's denial: the list goes by name. `/api/**`: `Cache-Control: no-store` unless a public route opts in. Images must come from our origin (`/media/…`): the CSP blocks others. |
| **Rate limits** | Better Auth `customRules` (production only, database storage): sign-in 5/min, sign-up 5/10 min, password-reset request 3/10 min, reset 5/10 min, verification email 3/10 min, change password 5/min, a guest's sign-in 30/10 min (D156); every other `/api/auth/**` route Better Auth's default 100/10 s, except `get-session`, which is never counted (asked on every page load; nothing to guess; counting it was a D1 write per visit and refused a busy cafe's shared Wi-Fi after 100 in 10 s). Workers rate-limit bindings (D121, `server/utils/rate-limit.ts`, numbers in `nuxt.config.ts`), per `cf-connecting-ip`, every cafe's address counted together (D140): `…/public/checkout/quote` 120/min, the rest of `…/public/**`, `/api/tables/**`, `/api/cafes/**`, the browser error reports `/api/client-errors` (D149) and the leaked-password ranges `/api/password-ranges/**` (D210) 600/min (generous: the cafe's Wi-Fi is one address for many customers); placing an order (`POST …/shop/orders` and its cancel, never the order page's polling) 20/min (D156); deleting an account (`POST /api/me/delete-account`) 3/min (D237; the binding counts per 10 or 60 s only); 429 `RATE_LIMITED` with `Retry-After: 60`; nothing limited where no binding exists (dev, tests). Cloudflare WAF, once a domain exists: `/api/shop/orders`, `/api/public/checkout/quote` (each call reads the whole catalog), voucher lookup/redeem, `/api/tables/*` (QR guessing). |
| **Not rate limited** | `/api/health`, on purpose (D244). The watchdog Worker calls it from outside the zone, and Cloudflare sets `cf-connecting-ip` of every such Worker request to one shared address (`2a06:98c0:3600::103`): a per-address limit would let any stranger's Worker use up our watchdog's count and raise false DOWN alerts. It answers no details and Cloudflare's DDoS protection still applies. |
| **No `v-html`** | ESLint `vue/no-v-html` is an error (D244): while the CSP allows inline scripts, Vue's escaping is the XSS defence, and `v-html` turns it off. Render rich text from structured data instead. |
| **Page addresses** | Matched in their exact case (D226, `router.options.sensitive`): `/C/<slug>` or `/TABLE/<token>` is a 404, so the cafe check (`31.cafe-pages.ts`), `splitTenantUrl` and the route rules, which read lowercase paths, can't be skipped by changing the case. API routes were already case-sensitive. A new path check can rely on lowercase. |
| **Body size** | JSON bodies ≤ 64 KB (`readValidBody`); uploads ≤ 5 MB. One exception: a shop layout's save (`PUT …/admin/branches/{branchId}/layout`, D273) ≤ 768 KB (`LAYOUT_MAX_BODY_BYTES`), set by the route's `readValidBody(event, schema, maxBytes)` and by `workerBodyLimit` for its path. A route that raises its limit sets both. |
| **Enumeration** | Other people's records are 404. Sign-in errors don't say whether the email exists (Better Auth default). |
| **Tokens in URLs** | A table's QR token is 128 bits of HMAC-SHA256(`NUXT_QR_SECRET`, table id and QR version), and only its SHA-256 is stored: a leaked database doesn't reveal working QR links, while the server can rebuild a table's QR for the admin to print again (D91). Rotating a table's QR invalidates the old one; an archived table's or branch's QR is 404, like an unknown one. A deployed build without the secret refuses to serve table QRs. |

Request limits count received bytes before parsing, including chunked input and unused multipart fields. The Cloudflare entry applies them before Nitro buffers the body (D168); route readers apply them again after authorization. See [server reliability](../reference/server-reliability.md#request-bodies).

### Account bot verification (D217)

The four password/account-email actions use canonical Turnstile Siteverify in Better Auth's before hook, with strict success/action/exact deployment-hostname checks, a 2048-character token cap and ten-second timeout. Failures never attach upstream exceptions or keys/tokens. Keys stay in the existing Worker secret binding. The browser's public flag is not server authorization. New requests always use new tokens; expiry and replay are rejected by Cloudflare. Guest, 2FA, OAuth, health, webhook and order flows are not gated by this check. See [operations](operations.md#account-browser-verification-d217) for rollout and remaining real-token verification.

CSP permits only `https://challenges.cloudflare.com` for Turnstile scripts/frames; `connect-src` stays same-origin (plus the page's own `blob:` URLs, D274) and referrers use `strict-origin`. The SDK loads on protected submission, not ordinary menu loads. The order-placement limiter matches only the normalized collection POST (query/trailing slash included), so order cancellation/Telegram actions do not consume creation slots. Existing auth/guest limits remain unchanged.

## Uploads

- Only `media:upload` holders. Images only: JPEG, PNG, WebP (no SVG: it can carry script). The file's **first bytes** must be one of those and match the type the browser claimed; the size is checked from `Content-Length` before the body is read and again after. (NuxtHub's `ensureBlob` checks only the claimed type and the size, with a generic 400; our checks cover both with 413/415 and add the bytes, D57.)
- The server picks the key (`t/<tenantId>/menu/<uuid v7>.<ext>`, D136; keys from before stay `menu/<uuid v7>.<ext>`) and the content type; the client's file name is never used.
- Served with `X-Content-Type-Options: nosniff` and a long cache (keys never change).
- An upload is `temporary` until a record references it; a scheduled task deletes temporary objects older than 24 hours.

## Secrets

| Secret | Where |
|---|---|
| `NUXT_BETTER_AUTH_SECRET` | Per environment, ≥ 32 random characters. Rotation: Better Auth `secrets` (new first, old kept until sessions expire) |
| Email | No secret: each Worker's `EMAIL` binding (D212), allowed to send only from its own address |
| Cloudflare API token (CI) | GitHub Actions secret, scoped to the one account and the resources deployed. The jobs holding it run only actions pinned to a full commit id, and the workflow token is read-only by default (D244, `test/unit/ci-workflows.test.ts`) |
| `NUXT_BAKONG_ENCRYPTION_KEY` | Per environment, 32 random bytes (base64); seals each cafe's Bakong token in the database (AES-256-GCM, the cafe's id bound in as additional data, D148). Changing it makes the saved tokens unreadable (each cafe saves its token again); no rotation is built until there is a need |
| Each cafe's Bakong token | Pasted by the cafe's owner on Payments, sealed before it's stored, never answered, logged or audited (only its expiry) |

Never in the repo, never logged, never in error messages. `.env` is git-ignored; `.env.example` lists names only.

## Logging and privacy

- Every request gets a **request id** (Cloudflare's `cf-ray` when present, else generated), in logs and in error bodies (`data.requestId`), so a user's screenshot leads to the log line.
- Structured logs: `level`, `requestId`, `route`, `actor` id, `code`, duration. **Never log:** passwords, tokens, cookies, session ids, reset links, QR tokens, full request bodies, card data.
- `log` adds bounded recursive redaction and pathname-only context (D169), sanitizes sensitive URL/header/assignment text and handles Error/bigint/cycles. Keep callers secret-free; arbitrary opaque secrets in free text cannot be recognized automatically. See [server reliability](../reference/server-reliability.md#safe-structured-logs) for limits and regression cases.
- Both deployed environment configs set `observability.redact_query_string: true` (D215) for Cloudflare's automatic request URL metadata, separately from `log`. This does not sanitize URL paths, custom log text or historical logs. See the [rollout and verification plan](../plans/cloudflare-improvements.md#verification-and-rollback) before claiming live ingestion is verified.
- Web Analytics (D216) has narrowly permitted public-menu document scripts; token entry documents use `no-store, no-transform` and the referrer policy is `strict-origin`. The beacon strips URL queries/fragments but can collect paths, including later SPA paths; document CSP does not unload an existing script. Do not add personal/secret analytics dimensions or assume the zone rule alone guarantees exclusion. See [performance monitoring](operations.md#browser-performance-and-usage-d216).
- Personal data (email, phone, name) only where needed; audit metadata records **which fields** changed, not their values.
- **Privacy erasure** (D237): the account deletes itself (`POST /api/me/delete-account`, its password checked by Better Auth's `verifyPassword`): name and email replaced, sessions, password, two-step sign-in and reset links deleted, each cafe's profile anonymised; orders and ledgers stay with the emptied account. Refused for a guest, a platform account, an account with cafe access (the owner removes it first, so a cafe keeps its last owner) and with an order in progress; the batch repeats each check. The "account deleted" email goes to a verified address only. Retention: D229. [Plan](../plans/account-erasure.md).
- No card data is ever stored: counter payments record method and amount only.

## Checklist for every route

- [ ] It sits under the right surface (`public` / `shop` / `counter` / `admin`).
- [ ] It checks the permission (or is deliberately public and read-only).
- [ ] The branch (counter) comes from the path and is checked against membership.
- [ ] Params, query and body are validated with strict Valibot schemas, sizes bounded.
- [ ] Records outside the caller's scope answer 404.
- [ ] Writes check `version`; money/points/voucher actions take an `Idempotency-Key`.
- [ ] Privileged writes add an audit event in the same batch.
- [ ] A change to payment settings, admin access or owners calls `requireConfirmation` after the permission check (D246).
- [ ] Errors use shared codes or the feature's `*.errors.ts` factories, with user-safe messages; nothing internal leaks.
- [ ] The response is mapped (no raw rows) and contains nothing the caller shouldn't see.
- [ ] Tests cover the permission cases, each error code, and the race/replay case.

## Google account boundary (D259, D260)

Google is an optional redirect-only identity provider; server configuration requires both private credentials and an enabled rollout flag. Public `GET /api/account/providers` returns only `{ google: boolean }` using that same predicate, with no-store and the public address rate limit. It grants no access and reveals no credential. D260 supersedes the initial no-link policy: Better Auth may attach Google to an existing account only when both sides verified the same email. Keep `requireLocalEmailVerified: true`, `allowDifferentEmails: false`, no trusted-provider bypass and no provider profile overwrite. The native user-validation hook enforces verified Google email and, before linking, rechecks the stored local email, temporary-password/platform-setup flags and active ban. D262 permits configured two-step accounts to use Google as the first factor, followed by the native authenticator/backup-code challenge. Explicit linking has the same boundary. No second user or cafe access is created; existing password and memberships remain.

D262 checks temporary-password state and refuses a platform account without configured two-step sign-in before creating an OAuth session. For Google with two-step enabled, the native twoFactor after-hook deletes the provisional session and replaces its cookies with the pending challenge before the response is sent; no usable session survives until a valid TOTP or backup code. Other OAuth paths remain refused for two-step accounts. The callback wrapper reuses the native challenge handler, counters, expiry and replay checks; its following redirect hook accepts only the validated same-origin passive callback or legacy sign-in path. The admin plugin's ban check remains. Direct ID-token sign-in is disabled. OAuth initiation has a database-backed 5/minute limit; callbacks retain Better Auth's normal state-cookie/nonce validation and rate policy.

No Google bearer token is retained in the account table, and no provider avatar, external browser script or broader CSP allowance is added. Anonymous-order transfer uses the existing hook. No tenant permission, profile-creation rule, password-confirmation or erasure rule changes. [Rollout and tests](../plans/google-auth.md).

D261 popup completion uses a same-origin per-attempt BroadcastChannel carrying only the callback marker, random attempt ID and bounded status/error codes. The originating active scope validates origin/marker/attempt and then reads the actual session before announcing login; a guest cookie is insufficient. The callback grants nothing itself: it closes on acknowledgement or after 500 ms without one, and if the browser refuses, continues on `/sign-in` with only the bounded codes. `onAPIError.errorURL` is `/google-callback`, so OAuth failures without a usable state also end there; it has no attempt, so it reports nothing and only closes. No provider code, token or account data crosses the channel or enters browser storage.

D262 workspace Google entry points use the same provider and account rules. The shared popup verifies the completed non-guest cookie and announces the identity before invoking the workspace completion check. Existing server tenant/branch/platform permissions, session age, password confirmation, refusal and sign-out rules remain authoritative. Pending two-factor metadata never announces a login. See [workspace contract](../plans/google-auth.md#workspace-google-sign-in-d262-2026-11-04).
