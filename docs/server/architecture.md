# Architecture & conventions

← [Server standard](./README.md)

- [Shape of the system](#shape-of-the-system)
- [Surfaces and routes](#surfaces-and-routes)
- [Features](#features): layout, the layers inside a feature, rules
- [Anatomy of a route](#anatomy-of-a-route)
- [Conventions](#conventions): ids, money, time, naming, responses, lists
- [Writing data](#writing-data): versions, archiving, atomic writes, idempotency, audit
- [Errors](#errors)
- [Validation](#validation)
- [Side effects](#side-effects)
- [Tests](#tests)

---

## Shape of the system

One Nuxt 4 app, deployed as one Cloudflare Worker:

```
Browser ──► Nuxt app (customer site · /admin · /counter)
              │  same origin, one session cookie
              ▼
           Nitro /api  ──► Better Auth (/api/auth)
              │
              ├──► features ──────► D1 (NuxtHub db, Drizzle)
              │                   ──► R2 (NuxtHub blob)
              │                   ──► KV (NuxtHub cache)
              └──► Resend (email), after the write has committed
```

- The server owns every rule: prices, availability, order state, points, voucher use, permissions. A client asks; it never decides.
- **Rendering (D45):** the public customer pages are server-rendered (fast first load, visible to search engines); the admin and counter workspaces stay single-page apps. Set per route with `routeRules` (`ssr: false` for `/admin/**` and `/counter/**`) in step 5.2; today the whole app is `ssr: false`.
- There is no public API for outside clients. If a native app comes later, it gets its own decision (bearer tokens, a versioned surface).

## Surfaces and routes

Routes are Nuxt file routes, **unversioned** (the apps deploy together with the server). The first path segment is the **surface**: who calls it and what they may do.

| Surface | Caller | Auth | Examples |
|---|---|---|---|
| `/api/auth/**` | anyone | Better Auth owns it | sign-up, sign-in, sign-out, verify email, reset password |
| `/api/public/**` | anyone | none; read-only | `GET /api/public/menu`, `GET /api/public/tables/{token}` |
| `/api/shop/**` | signed-in customer (verified email) | session | `POST /api/shop/orders`, `GET /api/shop/points` |
| `/api/counter/{branchId}/**` | branch `manager` / `staff` | session + branch membership | `POST /api/counter/{branchId}/orders/{orderId}/ready` |
| `/api/admin/**` | platform `admin` | session + platform role | `PATCH /api/admin/menu/items/{itemId}` |
| `/api/webhooks/**` | external services (later) | signature, no session | |

Rules:
- **Resources are plural nouns, kebab-case:** `/api/admin/menu/items`, `/api/admin/voucher-templates`. Nest only for ownership (`/menu/items/{itemId}/variations`), at most two levels.
- **CRUD maps to methods:** `GET` list/read, `POST` create, `PATCH` partial update, `DELETE` archive-or-delete (see [Archiving](#archiving)).
- **Business actions are sub-resources with `POST`**, named with a verb: `/orders/{orderId}/accept`, `/ready`, `/complete`, `/cancel`, `/vouchers/{voucherId}/redeem`. Never change state through `PATCH status`.
- The branch in `/api/counter/{branchId}` comes from the path and is checked against the caller's membership. It is never read from a body field or trusted from the session alone.
- File layout mirrors the URL: `server/api/admin/menu/items/[itemId].patch.ts`.

## Features

Server code is organized **by feature** (one business area each), like the app's `app/features/`.

```
server/
├── features/
│   ├── identity/      # Better Auth config glue, roles, permissions, staff onboarding
│   ├── branches/      # branches (organizations), dining tables, QR tokens
│   ├── menu/          # categories, items, variations, modifiers, availability, sold-out
│   ├── media/         # uploads to R2, asset lifecycle
│   ├── customers/     # customer profiles
│   ├── loyalty/       # points ledger, voucher templates, vouchers, redemptions
│   ├── orders/        # quote, checkout, order state, counter payments
│   └── platform/      # audit events, idempotency keys, outbox
├── api/               # thin route files, grouped by surface
├── tasks/             # scheduled jobs (Nitro tasks)
├── middleware/        # request id, origin check
└── utils/             # shared glue: errors, validation, db, permissions (auto-imported in routes)
shared/contracts/      # request schemas and enums the app also uses (Valibot)
```

### Inside a feature

```
server/features/loyalty/
├── index.ts                  # PUBLIC API: what routes and other features may use
├── loyalty.schema.ts         # Drizzle tables (registered with NuxtHub via the hub:db:schema:extend hook)
├── loyalty.types.ts          # domain types: records, results returned to routes, command inputs
├── loyalty.repository.ts     # all database access for this feature's tables
├── loyalty.service.ts        # business rules and orchestration (the use cases)
├── loyalty.errors.ts         # this feature's error codes and error factories
├── loyalty.rules.ts          # optional: pure rules (point calculation, state machines), no I/O
├── loyalty.mappers.ts        # optional: record → response shape, when it isn't trivial
└── tests/
    ├── loyalty.service.test.ts   # against SQLite built from the migrations (server project)
    └── loyalty.rules.test.ts     # pure rules (unit project)
```

A big feature splits each layer **by aggregate**, with the same suffixes: `menu/items.repository.ts`, `menu/items.service.ts`, `menu/categories.service.ts`, … Split when a file passes about 300 lines or mixes two aggregates. `index.ts` stays the only entry point.

| Layer | Does | Must not |
|---|---|---|
| **`index.ts`** | Re-exports the service functions and types that routes and other features may use | Export the repository, the schema or anything internal |
| **`*.types.ts`** | Domain types: records (`LoyaltyAccount`), results returned to routes (`VoucherDetail`), command inputs (usually inferred from `shared/contracts`), the `Actor` it receives | Import Drizzle table objects into types the app sees |
| **`*.schema.ts`** | Drizzle tables, indexes, checks, foreign keys for **this feature's** tables | Define another feature's tables |
| **`*.repository.ts`** | Every query of this feature's tables. **Reads** run and return typed records. **Writes** return **batch statements** (not executed), so the service can combine them with guards, audit and other features' statements into one atomic `db.batch` | Contain business rules, throw business errors, call other features, or know about HTTP |
| **`*.service.ts`** | The use cases (`exchangePoints`, `redeemVoucher`): load via repositories, apply rules, check state and versions, build the batch (with guards, audit, idempotency), run it, map the result | Write SQL or touch tables directly; read `event`, headers or cookies |
| **`*.errors.ts`** | Error codes of this feature and small factories (`insufficientPoints(balance)`) that call `apiError` with the right status and a user-safe message | Hold messages in routes or services inline |
| **`*.rules.ts`** | Pure functions: calculations, validations across fields, state machines | Do I/O |
| **`*.mappers.ts`** | Turn records into response shapes (never return raw rows) | Query anything |

Dependencies point one way: **route → service → repository → schema**. Types and errors are used by all of them.

### Rules

1. **Routes call a feature's service through its `index.ts`, nothing else.** No SQL, rule or cross-table write in a route file.
2. **Only a feature's repository touches its tables.** Services never write SQL, and no other feature touches those tables.
3. **Features talk through `index.ts` only.** `orders` asks `menu` for current prices (`menu.priceLines(...)`), never its repository. A write that spans features stays atomic: the owner of the action (`orders.complete`) asks the other feature for its statements (`loyalty.earnStatements(...)`, a service function that validates and returns batch statements) and runs them in its own `db.batch`.
4. **Services and repositories take `db` as their first parameter and use explicit imports** (no Nitro auto-imports), so tests run them against SQLite directly.
5. **Nothing in a feature knows about HTTP** except by throwing errors from `*.errors.ts`. The `actor` comes in as a parameter.
6. **Every file carries its feature's name** (`loyalty.service.ts`, not `service.ts`), so editor tabs, stack traces and search results are unambiguous.

### Example

```ts
// loyalty.repository.ts: queries run, writes return statements
export function findAccount(db: Db, userId: string): Promise<LoyaltyAccount | undefined> { … }
export function debitStatement(db: Db, account: LoyaltyAccount, points: number) {
  return db.update(loyaltyAccounts)
    .set({ balance: sql`${loyaltyAccounts.balance} - ${points}`, version: sql`${loyaltyAccounts.version} + 1` })
    .where(and(eq(loyaltyAccounts.userId, account.userId), eq(loyaltyAccounts.version, account.version)))
}
export function entryStatement(db: Db, entry: NewLoyaltyEntry) { return db.insert(loyaltyEntries).values(entry) }

// loyalty.service.ts: rules + one atomic batch
export async function exchangePoints(db: Db, actor: Actor, input: ExchangeInput, idempotencyKey: string): Promise<VoucherDetail> {
  const account = await repo.findAccount(db, actor.userId)
  const template = await repo.findTemplate(db, input.templateId)
  if (!template || template.pointsCost === null) throw templateNotExchangeable()
  if (!account || account.balance < template.pointsCost) throw insufficientPoints(account?.balance ?? 0)
  const voucherId = newId()
  await runBatch(db, [
    repo.debitStatement(db, account, template.pointsCost),
    requireOneChange(db),                                   // changed meanwhile → nothing applies
    repo.entryStatement(db, { … reason: 'exchange_voucher', idempotencyKey }),
    repo.voucherStatement(db, { id: voucherId, … }),
    platform.auditStatement(db, actor, 'loyalty.exchange', …),
  ])
  return toVoucherDetail(await repo.findVoucher(db, voucherId))
}
```

## Anatomy of a route

```ts
// server/api/admin/menu/items/[itemId].patch.ts
import { updateItemInput } from '#shared/contracts/menu'
import { menu } from '~~/server/features/menu'

export default defineEventHandler(async (event) => {
  const actor = await requirePermission(event, { menu: ['write'] })   // 1. who, allowed?
  const itemId = readIdParam(event, 'itemId')                          // 2. validate params,
  const input = await readValidBody(event, updateItemInput)            //    body, query
  return menu.updateItem(useDb(), actor, itemId, input)                // 3. one service call
})
```

The return value is the response body. Nuxt infers its type, so `$fetch('/api/admin/menu/items/…', { method: 'PATCH' })` is typed in the app without a hand-written response type.

## Conventions

| Topic | Rule |
|---|---|
| **Ids** | **UUID v7** for our tables (time-ordered: good indexes, "newest first" for free), generated in the app. Better Auth tables keep Better Auth's ids. Ids are opaque to clients: never parse them. |
| **Money** | Integer **minor units** (`priceMinor`, `totalMinor`) + a currency code (`USD`). Never floats. Rounding happens in named places (the pricing rules) with a documented rule. |
| **Instants** | Stored as UTC milliseconds; sent as ISO 8601 strings (`2026-09-27T08:30:00.000Z`). |
| **Local times** | Opening hours and availability are **minutes after midnight + the branch's IANA timezone**. The "business day" (pickup numbers, reports) is computed in the branch timezone. |
| **Names** | Tables `snake_case` plural (`menu_items`); columns `snake_case` in SQL, `camelCase` in TypeScript and JSON (Drizzle `casing: 'snake_case'`). Enum values are lower `snake_case` strings (`dine_in`, `paid_at_counter`) with a `CHECK`. |
| **Booleans** | Named as facts: `isDefault`, `soldOut`. Never a nullable boolean. |
| **Responses** | The resource itself, no envelope. Nullable fields are always present (`null`, not missing). Never return a raw database row: map it to the response shape so internal columns can't leak. |
| **Management lists** | `?page=1&pageSize=20` (max 100) → `{ items, page, pageSize, total }`. For admin tables with page numbers. |
| **Feeds** | `?limit=50&cursor=…` → `{ items, nextCursor }` (keyset on the UUID v7 id or a timestamp). For orders history, the queue, ledgers and audit, which grow without bound. |
| **Filters** | Query parameters named after fields (`?status=active&categoryId=…`); `q` for text search; `sort=name` / `sort=-createdAt`. Unknown parameters are rejected. |

## Writing data

### Versions (optimistic concurrency)

Every editable record has `version`. An edit sends the version it read; the write applies only if it still matches, otherwise **409 `VERSION_CONFLICT`** and nothing changes. The UI shows "changed by someone else, reload". Status-changing actions (accept, ready…) also check the current state in the same conditional write.

### Archiving

- Business records (menu items, categories, option sets, add-on groups, voucher templates, tables, staff access) are **archived**: `status = 'archived'` (or `archived_at`), hidden from lists and pickers by default, kept for history and reports, restorable.
- **Hard delete** only when nothing ever referenced the record (e.g. a draft item never published or ordered), and for privacy erasure (customers, see security.md).
- **Never deleted:** orders and their lines, payments, ledgers, voucher redemptions, audit events. Corrections are new records (reversals).
- `DELETE` on a resource archives it when it has history, and deletes it when it has none. The response says which (`{ archived: true }`).

### Atomic writes

D1 has no interactive transactions. A write that touches several rows is **one `db.batch([...])`**, which is all-or-nothing:
- Statements that must only apply if a check still holds are guarded: `requireOneChange` after a conditional `UPDATE … WHERE version = ?`, `requireCount` for set checks (`server/utils/db.ts`).
- Reads for validation happen before the batch; the guard catches anything that changed in between.

### Idempotency

Actions where a retry must never apply twice (placing an order, recording a payment, redeeming a voucher, exchanging points, awarding points) take an **`Idempotency-Key` header** (a UUID the client generates per user action):
- First call: the key, a hash of the request and the result are stored in the same batch as the action.
- Same key, same request: the stored result is returned (HTTP 200, same body).
- Same key, different request: **422 `IDEMPOTENCY_MISMATCH`**.
- Keys expire after 24 hours (a scheduled task removes them).

Internal awards (points on completion) use a deterministic key (`earn:order:{orderId}`) with a unique index, so they can't double-apply even without a header.

### Audit

Every privileged write (admin and counter surfaces, role changes, points adjustments, refunds) adds an `audit_events` row **in the same batch**: actor, action (`menu.item.update`), target, branch, safe metadata (field names changed, never secrets or full personal data).

## Errors

Nuxt/h3's standard error shape, with our code:

```json
HTTP 409
{
  "statusCode": 409,
  "message": "This item was changed by someone else. Reload it and try again.",
  "data": { "code": "VERSION_CONFLICT", "requestId": "…" }
}
```

- Throw `apiError(status, code, message, { fieldErrors })`. `fieldErrors` maps a field path (`variations.0.priceMinor`) to messages.
- **4xx messages are written for the user** and are shown as they are. **5xx never carry details**: the error handler replaces the message and logs the cause with the request id.
- Codes are `UPPER_SNAKE`, defined in the feature's `*.errors.ts` (shared codes in `server/utils/errors.ts`), and documented with their status.

| Status | When | Shared codes |
|---|---|---|
| 400 | Invalid input | `VALIDATION_FAILED` |
| 401 | No session | `UNAUTHENTICATED` |
| 403 | Signed in, not allowed; email not verified; write from another origin | `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `PASSWORD_CHANGE_REQUIRED` |
| 404 | Not found, or not visible to this caller | `NOT_FOUND` |
| 409 | Stale version, wrong state, still in use | `VERSION_CONFLICT`, `INVALID_STATE`, feature codes |
| 413 / 415 | Upload too large / wrong type | `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA` |
| 422 | Understood but refused by a business rule | `IDEMPOTENCY_MISMATCH`, feature codes (`ITEM_SOLD_OUT`, `INSUFFICIENT_POINTS`) |
| 429 | Rate limited | `RATE_LIMITED` |
| 5xx | Our fault | `INTERNAL` |

A record another branch or customer owns is **404**, not 403: don't confirm it exists.

## Validation

- Every input is validated with **Valibot** before any logic: body, route params and query. Schemas that the app also needs (forms, enums) live in `shared/contracts/<domain>.ts`; server-only ones stay in the feature (`*.types.ts`).
- Objects are **strict** (unknown keys rejected) on writes. Strings are trimmed and length-bounded; numbers bounded; arrays bounded.
- `readValidBody(event, schema)` also enforces the body size limit. Failures become `400 VALIDATION_FAILED` with `fieldErrors`.
- Validation checks shape; **business rules live in the service** (and `*.rules.ts`) (e.g. "this modifier belongs to this item").

## Side effects

Anything outside the database (email, cache purge, R2 object deletes) happens **after** the batch commits, never inside it.
- Must-not-lose effects (verification email, order notifications later) go through an **`outbox`** row written in the same batch; a scheduled task delivers and retries them.
- Best-effort effects (purging the public menu cache) run directly after the commit; failure is logged, not surfaced.

## Tests

| Level | What | Where |
|---|---|---|
| Rules | Pure functions: availability, pricing, state machines | `server/features/<f>/tests/*.rules.test.ts` (unit project) |
| Services | Every command and query against SQLite built from the real migrations, foreign keys on: happy path, each error code, **a stale-version or race case for every conditional write**, **a replay case for every idempotent action** | `server/features/<f>/tests/*.service.test.ts` (server project). Repositories are tested through their services |
| Routes | Permission wiring: each route rejects the wrong surface/role/branch (401/403/404) and accepts the right one | route tests against the built server (added in the platform phase) |
| App | Screens against a mocked API | `test/e2e` |

Check that a guard test guards something: remove the guard and see it fail.
