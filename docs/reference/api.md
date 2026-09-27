# API: `/api/v1` (pre-standard, being replaced)

> **Read this first.** This page documents the routes the admin screens use **today**. They predate the [server standard](../server/README.md) (D43) and are replaced step by step: identity in step 1.7, the menu in step 3.8 ([progress.md](../progress.md#next-steps-recommended-order)). **Don't add routes here or copy these patterns** (`/api/v1`, `requireStaff`, `staff_profiles`, the bootstrap route, the D41 menu tables). New server work follows docs/server/. This page is deleted when step 3.8 lands.

Our own API, served by Nitro in this app. Contracts (types and the request schemas the server validates with) are in `shared/contracts/`; server code is in `server/`. Why it looks like this: D40 (identity, errors, ids) and D41 (menu).

- [Conventions](#conventions)
- [Errors](#errors)
- [Calling it from the admin UI](#calling-it-from-the-admin-ui): `apiFetch`
- [Identity](#identity): session, staff, bootstrap
- [Menu](#menu): categories, schedules, products, media
- [Server structure](#server-structure): adding a route

## Conventions

| Rule | Detail |
|---|---|
| Paths | `/api/v1/admin/*` for the admin workspace. Planned: `/public/*`, `/customer/*`, `/staff/*` (cashier), `/webhooks/*` (system blueprint §6). Better Auth owns `/api/auth/*`. |
| Auth | The Better Auth session cookie (same origin). Every admin route starts with `requireStaff(event, permission)`. |
| CSRF | Writes (`POST`/`PATCH`/`PUT`/`DELETE`) need this site's `Origin` (or `Referer`); browsers send it. Others get 403. |
| Ids | Opaque strings (UUID v4). Never parse them. |
| Times | ISO 8601 UTC strings (`createdAt`, `updatedAt`). Schedule times are `HH:mm` local wall time in the record's `timeZone`. |
| Money | Integer cents (`priceMinor`, `priceDeltaMinor`), USD only. |
| Lists | Small lists return an array. Growing lists are paginated: query `page` (1-based) and `pageSize` (≤ 100), response `{ items, page, pageSize, total, totalPages }` (`Page<T>`). |
| Filters | Query strings; an empty value means "no filter". |
| Create | `POST`, 201 with the created record. |
| Update | `PATCH` with `version` plus only the fields to change: **absent keeps, `null` clears**. 200 with the saved record. |
| Delete | `DELETE …/{id}?version=<n>`, 204. |
| Concurrency | A stale `version` gets 409 `VERSION_CONFLICT`; nothing is written. |
| Audit | Every privileged write adds an `audit_events` row in the same atomic write. |

## Errors

Every failure is an HTTP error status with this JSON body:

```json
{ "statusCode": 409, "message": "…", "data": { "code": "VERSION_CONFLICT", "message": "This category was changed by someone else. Reload it and try again." } }
```

`data` is `ApiErrorBody` (`shared/contracts/common.ts`): `code`, a user-safe `message`, and for validation `fieldErrors` (`{ "name": ["Required"], "variantGroups.0.options.1.name": ["Required"] }`).

| Status | Codes | Meaning |
|---|---|---|
| 400 | `VALIDATION_FAILED`, `REFERENCE_NOT_FOUND`, `CATEGORY_DEPTH` | Bad input; a referenced record doesn't exist; a category would be three levels deep |
| 401 | `UNAUTHENTICATED` | No session |
| 403 | `NOT_STAFF` | Signed in, but not an active staff member (e.g. a customer) |
| 403 | `FORBIDDEN` | Missing permission, or a write from another origin |
| 404 | `NOT_FOUND`, `USER_NOT_FOUND`, `BOOTSTRAP_DISABLED` | |
| 409 | `VERSION_CONFLICT`, `ORDER_STALE`, `CATEGORY_HAS_CHILDREN`, `CATEGORY_IN_USE`, `SCHEDULE_IN_USE`, `ADMIN_EXISTS` | The write conflicts with current data |
| 413 / 415 | `MEDIA_TOO_LARGE` / `UNSUPPORTED_MEDIA` | Upload rejected |
| 5xx | anything | A crash: the client shows a generic message |

Server side: throw `apiError(status, code, message, fieldErrors?)` (`server/utils/api-error.ts`); `parseInput`/`readBodyAs`/`readQueryAs` (`server/utils/validation.ts`) produce `VALIDATION_FAILED`. Client side: [`ApiError`](./errors.md) reads both this format and Better Auth's (`{ code, message }`).

## Calling it from the admin UI

```ts
import type { Page } from '#shared/contracts/common'
import type { Category, Schedule, UpdateCategoryBody } from '#shared/contracts/menu'

const categories = await apiFetch<Category[]>('/admin/categories')
const page = await apiFetch<Page<Schedule>>('/admin/schedules', { query: { page: 1, pageSize: 20, status: 'ACTIVE' } })
const body: UpdateCategoryBody = { version: 3, name: 'Tea' }
await apiFetch<Category>(`/admin/categories/${id}`, { method: 'PATCH', body })
```

`apiFetch` (`app/utils/api.ts`, auto-imported; engine `app/utils/api-fetch.ts`):
- base `/api/v1`, same-origin cookie, 30 s timeout (pass `timeout` for uploads), **no retries**;
- every failure throws `ApiError`;
- a 401 or 403 `NOT_STAFF` clears the session (the app goes to login);
- a response to a request started under a previous identity is discarded as a silent `aborted` error (D29).

Reads go through `useApiQuery`, writes through `useMutation` ([data fetching](./data-fetching.md), [mutations](./mutations.md)).

## Identity

| Route | Permission | Body / query | Response |
|---|---|---|---|
| `GET /admin/me` | staff | | `StaffSession`: `{ userId, email, displayName, role, permissions }` |
| `POST /bootstrap/admin` | none (token) | `{ token, email, displayName? }` | `StaffSession` |
| Better Auth `POST /api/auth/sign-up/email` | none | `{ email, password, name }` | Creates an **account** (not staff) |
| Better Auth `POST /api/auth/sign-in/email` | none | `{ email, password }` | Sets the session cookie |
| Better Auth `POST /api/auth/sign-out` | session | `{}` | Clears it |

Roles and permissions: `shared/contracts/identity.ts`. Only `admin` exists (all permissions: `menu.read`, `menu.write`, `media.write`) until the role matrix is decided (Q6).

**First admin (bootstrap):** set `NUXT_BOOTSTRAP_TOKEN` (≥ 32 random characters), sign the owner up, then

```bash
curl -X POST http://localhost:3000/api/v1/bootstrap/admin \
  -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
  -d '{"token":"<the token>","email":"owner@example.com"}'
```

It is refused once an admin exists (409 `ADMIN_EXISTS`). Remove the token afterwards. Adding more staff needs a staff-management feature (not built).

## Menu

All under `/api/v1/admin`, permission `menu.read` for reads and `menu.write` for writes. Types in `shared/contracts/menu.ts`.

### Categories: `Category`

| Route | Notes |
|---|---|
| `GET /categories?level=main\|sub` | Every category (not paginated), in sort order |
| `POST /categories` | `{ name, parentId?: string \| null, status? }`. Appended last among its siblings. The parent must be a main category (400 `CATEGORY_DEPTH`) |
| `PATCH /categories/{id}` | `{ version, name?, parentId?, status? }`. `parentId: null` makes it a main. A category with subs can't become a sub (409 `CATEGORY_DEPTH`). A moved category goes last among its new siblings |
| `DELETE /categories/{id}?version=` | 409 `CATEGORY_HAS_CHILDREN` / `CATEGORY_IN_USE` (menu items) |
| `PUT /categories/order` | `{ lists: [{ parentId: string \| null, ids: string[] }] }`: each list is **every** child of that parent, in the new order (numbered from 1). A list that doesn't match the current children: 409 `ORDER_STALE`, nothing applied. Doesn't change `version`. Returns every category |

### Schedules: `Schedule`, `ScheduleDetail`, `ScheduleOption`

| Route | Notes |
|---|---|
| `GET /schedules?page&pageSize&search&status&day` | Paginated, sorted by name. `day` = `MONDAY`…`SUNDAY` |
| `GET /schedules/options` | Every schedule `{ id, name, status }`, for pickers |
| `GET /schedules/{id}` | Plus `products: { id, name, status }[]` that follow it |
| `POST /schedules` | `{ name, description?, days, startTime, endTime, status? }`. The zone is the cafe's (`NUXT_PUBLIC_CAFE_TIME_ZONE`) |
| `PATCH /schedules/{id}` | `{ version, …fields }`. Never takes menu items: they are linked from the menu item (`scheduleIds`) |
| `DELETE /schedules/{id}?version=` | 409 `SCHEDULE_IN_USE` while any menu item follows it (Q16) |

Times are `HH:mm` local wall time in `timeZone`, shown as stored. The end must be after the start (overnight ranges are refused until decided, Q14).

### Products (menu items): `Product`

| Route | Notes |
|---|---|
| `GET /products?page&pageSize&search&categoryId&status` | Paginated, sorted by name |
| `GET /products/all?search&categoryId&status` | The whole filtered menu (≤ 1000), for the grouped grid |
| `GET /products/{id}` | |
| `POST /products` | `{ name, description?, categoryId, priceMinor, imageAssetId?, status?, scheduleIds?, variantGroups? }` |
| `PATCH /products/{id}` | `{ version, …fields }`. `imageAssetId: null` removes the image. `scheduleIds` and `variantGroups` replace the whole list |
| `DELETE /products/{id}?version=` | Removes its variants and schedule links |

`variantGroups` is the complete list in display order: `{ id?, name, minSelect, maxSelect: number | null, options: [{ id?, name, priceDeltaMinor }] }`. An `id` updates that group/option in place, no `id` creates one, and anything left out is deleted. An id of another menu item is rejected (400 `REFERENCE_NOT_FOUND`).

### Media

| Route | Notes |
|---|---|
| `POST /media` | Multipart, field `file`. JPEG/PNG/WebP (checked by content), ≤ 5 MB. Returns `{ id, url }`. Stored in R2 (`menu/<uuid>.<ext>`) as a temporary asset until a menu item is saved with it |
| `GET /media/menu/<key>` | Serves a menu image (public, cached for a year: keys never change) |

Replacing or deleting a menu item's image releases the old asset back to `temporary`. A cleanup job for temporary assets isn't built yet.

## Server structure

```
server/
├── api/v1/…            # thin route files: requireStaff → readBodyAs/readQueryAs → service
├── db/schema/*.ts      # Drizzle tables (NuxtHub reads these); db/tables.ts re-exports them
├── db/migrations/      # checked-in SQL (pnpm nuxt db generate)
├── db/types.ts         # Db type, batch guards (requireOneChange, requireCount), error helpers
├── features/<domain>/  # services: all business rules and SQL; take `db` as a parameter
├── middleware/         # origin check (CSRF)
└── utils/              # apiError, validation, requireStaff, useDb (auto-imported in routes)
```

Adding a route:
1. Contract in `shared/contracts/<domain>.ts` (Valibot schema + response type).
2. Service function in `server/features/<domain>/`: explicit imports only, `db` as the first parameter, one `db.batch([...])` per multi-statement write with a guard, an audit row for privileged writes. Throw `apiError`.
3. Route file: `requireStaff(event, '<permission>')`, parse with `readBodyAs`/`readQueryAs`/`idParam`, call the service.
4. Tests in `test/server/<domain>.test.ts` against `createTestDb()` (real migrations, foreign keys on), including a stale-version or race case for every conditional write.
5. Schema change: edit `server/db/schema/`, run `pnpm nuxt db generate`, rename the migration to say what it does, update `meta/_journal.json`'s tag to match.
