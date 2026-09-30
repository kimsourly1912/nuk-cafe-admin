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
| Email verification, password reset | Better Auth `emailVerification` / `sendResetPassword`, delivered with Resend |
| Platform role, ban, admin-created users, revoke sessions | Better Auth **`admin`** plugin |
| Branches, branch staff and their roles | Better Auth **`organization`** plugin (a branch is an organization) |
| Permission checks | Better Auth **access control** (`createAccessControl`) + `userHasPermission` / `hasPermission` |
| Rate limiting of auth routes | Better Auth `rateLimit` (database storage, `customRules`) |
| Breached passwords | Better Auth **`haveIBeenPwned`** plugin |
| Work on sign-up (create the loyalty account) | Better Auth `databaseHooks.user.create.after` |
| Session required on route groups | `@nuxtjs/better-auth` `routeRules` `auth` in `nuxt.config.ts`: `/api/admin/**` needs a session with role `admin`, `/api/counter/**` and `/api/shop/**` a session. A second line only (see Checking) |
| Upload size and type check | NuxtHub `ensureBlob(file, { maxSize, types })` (plus our magic-byte check: it trusts the claimed type) |
| Rate limiting our API, bot protection | Cloudflare WAF rate-limiting rules (edge, no code) |
| Security headers | Nitro `routeRules` `headers` (production builds, `securityHeaders()` in `nuxt.config.ts`) |
| Backups | D1 Time Travel |

**Don't use:** NuxtHub `blob.handleUpload` (stores under the client's file name and turns validation failures into 500s), and Better Auth impersonation (off until there's a support process for it).

## Identity

- **One account per person**, email + password, owned by Better Auth (`user`, `account`, `session`, `verification`).
- An account by itself grants **nothing** beyond the shop: access comes from the platform role and branch memberships.
- The same person can be staff and a customer on one account. **Staff never act on their own customer records**: no redeeming their own voucher, adjusting their own points or completing their own order payment. The server checks `actor.userId !== customer.userId` for those actions.

## Roles and permissions

Two layers, both Better Auth:

| Layer | Stored in | Roles |
|---|---|---|
| Platform | `user.role` (`admin` plugin) | `customer` (default for every sign-up), `admin` (owner/head office) |
| Branch | `member.role` (`organization` plugin), one row per branch | `manager`, `staff` |

Permissions are **statements** (`resource: [actions]`) defined once in `server/features/identity/identity.permissions.ts` with `createAccessControl`, and granted to roles there. Agreed with the owner on 2026-09-27 (D45):

| Resource | Action | admin | manager | staff |
|---|---|:-:|:-:|:-:|
| menu | read | ✔ | ✔ | ✔ |
| menu | write / publish | ✔ | | |
| menu | set sold out (own branch) | ✔ | ✔ | ✔ |
| media | upload | ✔ | | |
| branch | read / update | ✔ | read | read |
| staff | list, create / change role / disable | ✔ | | |
| table | manage, rotate QR | ✔ | ✔ | |
| order | read queue, ready, complete (payment starts preparation: no accept step) | ✔ | ✔ | ✔ |
| order | cancel | ✔ | ✔ | ✔ |
| payment | collect | ✔ | ✔ | ✔ |
| payment | refund | ✔ | | |
| voucher | look up, redeem | ✔ | ✔ | ✔ |
| voucher | issue to a customer | ✔ | ✔ | |
| voucher template | manage | ✔ | | |
| settings | KHR exchange rate, branch hours | ✔ | | |
| loyalty | adjust points | ✔ | ✔ | |
| report | read, export (the reports, their CSV and print, and sending them to Telegram; 8.1, D110) | ✔ | read, own branch (not used yet: managers have no admin portal, D52) | |
| audit | read | ✔ | own branch | |
| assistant | use the AI assistant (phase 9, D107, D108) | ✔ | | |
| Better Auth `user` / `session` admin endpoints | create, list, set role, ban, set password, revoke sessions… | ✔ (no impersonation) | | |
| Better Auth `organization` / `member` / `invitation` / `ac` endpoints | update, delete, add or remove members, invite | | | |

The last two rows are Better Auth's own statements: branch roles get **none** of them, so managers can't add staff or change the branch through Better Auth's endpoints; staff changes go through our admin routes. `server/features/identity/tests/identity.permissions.test.ts` asserts this whole table, one row per grant.

A platform `admin` has every branch permission in every branch: **our** `requireBranchPermission` grants that, because Better Auth only knows branch roles for members of that branch (spike, 2026-09-27).

**Checking** (`server/utils/access.ts`, auto-imported in routes; the decisions are `authorize*` in `server/features/identity/identity.service.ts`):

| Helper | Surface | Refuses with |
|---|---|---|
| `requirePermission(event, { menu: ['write'] })` | `/api/admin` | 401 no session / banned; 403 `PASSWORD_CHANGE_REQUIRED`; 403 `FORBIDDEN` when the platform role lacks **any** requested action |
| `requireBranchPermission(event, branchId, { order: ['cancel'] })` | `/api/counter/{branchId}` | 401; 403 `PASSWORD_CHANGE_REQUIRED`; **404** for an unknown or archived branch, a branch the caller isn't a member of, or an unknown membership role; 403 `FORBIDDEN` for a member whose role lacks the action. A platform admin passes in every active branch without being a member |
| `requireCustomer(event)` | `/api/shop` writes | 401; 403 `PASSWORD_CHANGE_REQUIRED`; 403 `EMAIL_NOT_VERIFIED` |
| `requireSignedIn(event)` | own-account reads | 401; 403 `PASSWORD_CHANGE_REQUIRED` |

- Each returns the **actor** (`{ userId, role }`, plus `branchId` and `branchRole?` on the counter) that services receive and write to the audit log.
- The branch id comes from the path (`readIdParam(event, 'branchId', 'The branch')`), never from a body. Better Auth's tables use UUID v7 like ours (`advanced.database.generateId`), so `readIdParam` applies to users and branches too.
- Deny by default: a route without a permission check is a bug. The `routeRules` session gate catches a forgotten check on the admin surface (401, or 403 for non-admins) but can't see branches, permissions, `mustChangePassword` or email verification.
- Tests: `identity.service.test.ts` covers every refusal above (each guard checked to fail its test when removed). The route wiring was checked against a production build with temporary probe routes (D48); per-route tests come with the first real routes (step 1.4).
- Only admins can create branches (`allowUserToCreateOrganization: user => user.role === 'admin'`). Better Auth always makes the creator a member; our config names that membership `manager` (`creatorRole`), since `owner` isn't one of our roles.
- Branches are never deleted (`disableOrganizationDeletion`); they're archived through `organization.status`.
- The whole configuration is `identityAuthOptions()` in `server/features/identity/identity.auth.ts`; `server/auth.config.ts` only passes it the site URL.

## Sessions

- Better Auth database sessions, HttpOnly + `Secure` (production) + `SameSite=Lax` cookie, one origin.
- Lifetime: **7 days for everyone**, refreshed daily while used (Better Auth default; D45).
- **Revoke all sessions** of a user when their role changes, they're removed from a branch, their staff access is disabled, or they're banned (`admin.revokeUserSessions`).
- `trustedOrigins` is the origin of `NUXT_PUBLIC_SITE_URL` (the module adds localhost origins in dev only). The origin check on our routes (`server/middleware/10.origin-check.ts`) accepts the same origin.

## Staff onboarding

Built in step 1.4 (D49): `server/features/identity/staff.*`, routes under `/api/admin/staff`.

1. An admin creates the account with name, email and access: `admin` and/or one role per branch (several branches allowed). The server generates a **temporary password** (16 characters, e.g. `Hq7x-3mPa-kR9t-Wz2c`), returns it **once** for the admin to hand over, and stores only Better Auth's hash. The email is marked verified (the admin vouches for it).
2. The account carries `mustChangePassword = true` (a Better Auth `user.additionalFields` field).
3. While it's set, our access helpers answer **403 `PASSWORD_CHANGE_REQUIRED`** on every surface; Better Auth's `/api/auth/**` still works, and the app shows the change-password screen (step 1.7). (On `/api/admin` a non-admin gets 403 `FORBIDDEN` from the route-rule gate first.)
4. Changing the password (Better Auth `/change-password`) clears the flag: an `after` hook in `identity.auth.ts`, only when the change succeeded. A reset link clears it too (the token's user is read in a `before` hook, since the token is gone afterwards). A password set by an admin stays temporary.
5. Changing someone's access replaces their admin role and memberships and **signs them out everywhere** (except an admin editing their own branches). Disabling = removing the admin role and every membership and signing them out. Their account keeps working as a customer, and can be given access again later.
6. Every change writes an `audit_events` row (`staff.create`, `staff.access.update`, `staff.disable`) with the access given, never a password.

| Case | Result |
|---|---|
| The email already has a **customer** account | That account gets the access; its password, points and orders are untouched; no temporary password (`temporaryPassword: null`) |
| The email already has **staff access** (or is an admin) | 409 `STAFF_ALREADY_EXISTS`: edit them instead |
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
- **Signing in works before verification; ordering doesn't:** `/api/shop/**` write routes (`requireCustomer`) answer **403 `EMAIL_NOT_VERIFIED`** until it is. Browsing the menu works without an account; `GET /api/shop/me` works signed in, verified or not.
- Password reset by email: the link works **once** and expires after **1 hour**; a reset **signs the account out everywhere** and clears a temporary password. A reset request answers the same whether or not the email has an account (the only difference is one outbox insert, a few milliseconds).
- Account emails go through the **outbox** (platform feature): Better Auth's callbacks only queue a message, and `platform:deliver-outbox` sends it within a minute, with retries. The link is in the message until it's sent, then dropped from the row.
- Every account gets a **customer profile** with a member code, from `databaseHooks.user.create.after` (sign-up) or in the staff-creation batch. The hook runs after the account is stored (no transactions on D1), so if it fails the account still works and `ensureProfile` creates the profile on first use. The loyalty account joins in step 7.1.

| Case | Result |
|---|---|
| Unverified customer places an order (any shop write) | 403 `EMAIL_NOT_VERIFIED` |
| Reset link used twice | Second use: 400 `INVALID_TOKEN` (Better Auth) |
| Reset requested for an unknown email | Same 200 answer, no email |
| Staff on a temporary password resets by email | Flag cleared, like changing it |
| The sign-up hook fails to create the profile | Logged; created on the first `ensureProfile` (e.g. `GET /api/shop/me`) |
- An admin can **ban** an abusive account (`admin.banUser`), which ends its sessions.

## Request protection

| Protection | Rule |
|---|---|
| **CSRF** | Every non-GET request to `/api/**` except `/api/auth/**` (Better Auth checks its own) and `/api/webhooks/**` must carry an `Origin` (or `Referer`) in `trustedOrigins`. Otherwise 403. `GET` never changes state. |
| **Webhooks** | `/api/webhooks/telegram` (D112) is called by Telegram, not a browser: no session, no origin check. It compares `X-Telegram-Bot-Api-Secret-Token` with `NUXT_TELEGRAM_WEBHOOK_SECRET` in constant time before reading the body (401 otherwise). What it can do is narrow: connect a chat with a valid one-time code (a group only from one of its admins, and only after a portal admin confirms), mark a chat blocked, follow a supergroup's new id. |
| **Headers** | Production builds, every route: `Content-Security-Policy` (`default-src 'self'`; scripts and styles also `'unsafe-inline'` until SSR brings nonces in step 5.2; images `'self' data: blob:`; `connect-src 'self'`; `object-src 'none'`; `base-uri` and `form-action 'self'`; `frame-ancestors 'none'`), `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy` denying camera, microphone, geolocation and payment (loosen camera if QR scanning needs it). `/api/**`: `Cache-Control: no-store` unless a public route opts in. Images must come from our origin (`/media/…`): the CSP blocks others. |
| **Rate limits** | Better Auth `customRules` (production only, database storage): sign-in 5/min, sign-up 5/10 min, password-reset request 3/10 min, reset 5/10 min, verification email 3/10 min, change password 5/min. Cloudflare WAF: `/api/shop/orders`, `/api/public/checkout/quote` (each call reads the whole catalog), voucher lookup/redeem, `/api/public/tables/*` (QR guessing). |
| **Body size** | JSON bodies ≤ 64 KB (`readValidBody`); uploads ≤ 5 MB. |
| **Enumeration** | Other people's records are 404. Sign-in errors don't say whether the email exists (Better Auth default). |
| **Tokens in URLs** | A table's QR token is 128 bits of HMAC-SHA256(`NUXT_QR_SECRET`, table id and QR version), and only its SHA-256 is stored: a leaked database doesn't reveal working QR links, while the server can rebuild a table's QR for the admin to print again (D91). Rotating a table's QR invalidates the old one; an archived table's or branch's QR is 404, like an unknown one. A deployed build without the secret refuses to serve table QRs. |

## Uploads

- Only `media:upload` holders. Images only: JPEG, PNG, WebP (no SVG: it can carry script). The file's **first bytes** must be one of those and match the type the browser claimed; the size is checked from `Content-Length` before the body is read and again after. (NuxtHub's `ensureBlob` checks only the claimed type and the size, with a generic 400; our checks cover both with 413/415 and add the bytes, D57.)
- The server picks the key (`menu/<uuid v7>.<ext>`) and the content type; the client's file name is never used.
- Served with `X-Content-Type-Options: nosniff` and a long cache (keys never change).
- An upload is `temporary` until a record references it; a scheduled task deletes temporary objects older than 24 hours.

## Secrets

| Secret | Where |
|---|---|
| `NUXT_BETTER_AUTH_SECRET` | Per environment, ≥ 32 random characters. Rotation: Better Auth `secrets` (new first, old kept until sessions expire) |
| `NUXT_RESEND_API_KEY` | Per environment; staging uses a restricted key |
| Cloudflare API token (CI) | GitHub Actions secret, scoped to the one account and the resources deployed |

Never in the repo, never logged, never in error messages. `.env` is git-ignored; `.env.example` lists names only.

## Logging and privacy

- Every request gets a **request id** (Cloudflare's `cf-ray` when present, else generated), in logs and in error bodies (`data.requestId`), so a user's screenshot leads to the log line.
- Structured logs: `level`, `requestId`, `route`, `actor` id, `code`, duration. **Never log:** passwords, tokens, cookies, session ids, reset links, QR tokens, full request bodies, card data.
- Personal data (email, phone, name) only where needed; audit metadata records **which fields** changed, not their values.
- **Privacy erasure** of a customer: anonymize the profile (name, email, phone replaced), keep orders and ledgers with the anonymized customer, delete sessions and accounts. [Open]: retention periods (Q24).
- No card data is ever stored: counter payments record method and amount only.

## Checklist for every route

- [ ] It sits under the right surface (`public` / `shop` / `counter` / `admin`).
- [ ] It checks the permission (or is deliberately public and read-only).
- [ ] The branch (counter) comes from the path and is checked against membership.
- [ ] Params, query and body are validated with strict Valibot schemas, sizes bounded.
- [ ] Records outside the caller's scope answer 404.
- [ ] Writes check `version`; money/points/voucher actions take an `Idempotency-Key`.
- [ ] Privileged writes add an audit event in the same batch.
- [ ] Errors use shared codes or the feature's `*.errors.ts` factories, with user-safe messages; nothing internal leaks.
- [ ] The response is mapped (no raw rows) and contains nothing the caller shouldn't see.
- [ ] Tests cover the permission cases, each error code, and the race/replay case.
