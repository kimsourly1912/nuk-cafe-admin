# Server reliability APIs

Implemented in D168 after the [architecture audit](../reviews/architecture-audit-2026-10-14.md). Application behavior remains in the [server standard](../server/README.md).

## Request bodies

`readValidBody(event, schema)` accepts JSON, counts actual UTF-8 bytes before parsing, and preserves 413 for bodies over 64 KB. Invalid JSON returns 400. `Content-Length` is an early rejection only.

`readLimitedBody(event, maxBytes)` returns `Uint8Array<ArrayBuffer>`. `readLimitedMultipart(event, maxBytes)` limits the whole envelope before parsing and returns parts with `name`, `data`, optional `filename` and `type`. Routes still authorize before invoking these readers.

Nitro 2's Cloudflare preset buffers the request before H3. `server/cloudflare-entry.ts` wraps the original preset entry to enforce the same caps first: 64 KB for APIs, the image limit plus 64 KB for `/api/c/<slug>/admin/media`, and `PHOTO_UPLOAD_MAX_BYTES` for `/admin/media/photos`. It forwards bounded bytes and all original headers to Nitro, and preserves the preset's other handlers. Retest this wrapper when upgrading Nitro; do not replace it with a route-only check while the adapter buffers unbounded input.

## Delivery ownership

`deliverOutbox(db, handlers, options)` is exported from `#server/features/platform`. Options:

| Option | Default | Meaning |
|---|---|---|
| `now?: Date` | current clock | Deterministic test clock; production re-reads time before each claim/retry |
| `limit?: number` | 25 | Maximum messages read |
| `budgetMs?: number` | 20,000 | Stop starting work after this budget; an already-running send completes |
| `kinds?: string[]` | all | Restrict message kinds |
| `ids?: string[]` | all | Restrict message IDs; empty means no work |
| `order?: { tenantId, orderId }` | none | Restrict the exact tenant/order payload |

Each claim has a random `claim_token`; completion, retry and failure update only the current owner. Attempts come from the atomic claim, not a stale due-list snapshot. This also applies to notification and marketing delivery. Lease expiry still permits at-least-once sending; Telegram cannot deduplicate a message accepted just before a lost response.

D194 step 6 gives all four queues the shared SQL shape in `server/utils/claims.ts`: fresh token/attempt count, due/lease checks and exact token ownership. Cafe-owned claims and settlements name the cafe; order-ready alerts also fence the subscription and unsent state. The outbox still supports global rows. Notification success and its destination timestamp commit together in the service's guarded batch. Manual retries guard the failed state and audit the change in that same batch. See [repository standard → Background-task writes](../server/repositories.md#background-task-writes) for the helper contracts and connect-code semantics. Repository two-cafe tests, existing expired-worker/subscription race tests, a D1-shaped overview batch and real D1 cover these paths.

`sendOrderEventsNow(event, { tenantId, orderId }, kind)` sends only that order's matching event, with limit 1; the scheduled outbox run recovers other work. `deliverDue` and `deliverDuePosts` also accept `budgetMs` in their options. Budgets stop additional work, not a running provider request. Email Sending has a 10-second deadline; Telegram has a 20-second deadline. The immediate order-alert handler starts further notification sends only within a five-second budget.

## Durable media cleanup

Media APIs keep their existing signatures. Before uploading, `media_object_deletions` records provisional keys with a 24-hour grace period. The successful asset batch removes those provisional entries. Crashes and failed compensation leave recoverable deletion work.

Purge and sample-data reset enqueue the source and variant keys in the same batch that removes asset rows. R2 deletion happens afterwards. Successful deletion clears its queue entry; failure leaves the key for a later hourly run. Keys are never reused. The platform purge visits all cafes; per-cafe resets and object operations carry the tenant explicitly.

D194 step 7 keeps these batches in the media service. Provisional key plans commit all D1-sized pieces before R2 is written; an asset-commit failure after a successful put still compensates. Expiry discovery and deletion share `temporaryBefore`, and a typed self-alias checks that the source is still expired before its objects are queued. The service's delete guard makes a lost attach/release race change neither database rows nor R2 objects. Source/file reads use one joined batch per ID piece, scoped to the cafe. Support history also reads grants and their visits in one batch; its expiry guards reuse the reads' condition. Assistant completion now requires `finishUsage(db, tenantId, id, result)` and remains conditional on pending outcome. Sample-data leases keep their existing strict `< now` expiry; they are not changed to the delivery queues' `<= now` semantics.

## Bounded tenant jobs

`runTenantPage(db, job, work, limit = 25)` returns `{ processed, failures: string[] }`. It visits a page of active cafes ordered by ID, catches and logs each cafe's failure, saves progress in `job_cursors`, and wraps to the beginning after the last page. Failed cafes are retried on the next cycle; work must remain idempotent. Overlapping runs can repeat generation safely. The cursor is progress, not an exactly-once claim.

`activeTenantPage(db, after, limit)` and `tenantById(db, id)` are identity public APIs for platform orchestration, without granting permissions to cafe data. `bakongTokenExpiries(db, tenantId?)` can restrict reminders to the current cafe. Notification delivery runs before generation, so failed summaries cannot block existing due alerts. Summary and token-reminder generation also have independent failure boundaries within each cafe.

`readJobCursor(db, job)` / `saveJobCursor(db, job, cursor, { processed?, failures?, now? } = {})` store operational progress. `jobProgress(db, job)` returns activity/success instants and the latest processed/failure counts. A page with at least one successful cafe, or a successful empty page, updates `succeededAt`; an all-failed page advances the cursor/activity but preserves the last success. `isJobCurrent(db, job, maxAgeSeconds, now?)` checks **that success**, so a transient failure can recover while sustained total failure becomes stale. The optional health requirement uses `notifications:generate`; enable it only when Telegram and the cron are configured. Migration `0039_job_success` preserves prior cursors with a null success time, until fresh work runs.

Platform audit, outbox, idempotency and job queries have separate repositories (D194 step 7). Job cursor/run writes return statements for the existing public service APIs; success throttling uses typed date operators at the same five-minute boundary. Audit rows and their total share one snapshot and preserve native offset/limit pagination. Outbox ID targeting is chunked and merged by due time/id before the limit; event-kind and audit-action sets use the shared `inJsonArray` condition, as the catalog's internal item selection already did. Intersecting large sets cannot exhaust D1's bind count. Global outbox rows and the console's deliberate cross-cafe metadata reads retain their scope.

An empty page after a non-null cursor immediately wraps and processes the first page. It cannot invent success when every cafe fails and the cafe count is an exact multiple of the page size. Only an empty **first** page establishes that no active cafes need work.

`operationalHealth(db, { notificationMaxAgeSeconds, deliveryMaxAgeSeconds }, now?)` in `server/utils/health.ts` applies those optional checks. The delivery threshold checks `oldestDueOutbox` and `oldestDueNotification` across cafes; it rejects overdue pending work beyond the configured seconds. Future retry times and historical sent/failed rows are excluded. Both thresholds default to zero, leaving health database-only. Responses disclose no job/cafe/message detail. Terminal delivery failures retain the existing alert path.

## Fresh catalog reads

`getPublicMenu(db, tenantId, query, now?, itemIds?)` accepts an **internal** optional cart selection; it is not a public HTTP query parameter. Public browsing loads the full cafe catalog; checkout quotes and placement select their item IDs. A JSON-bound ID list respects D1's parameter limit, including duplicates, empty lists and IDs from other cafes. All variations, sets, option values, modifier rules/overrides and relevant availability checks for selected items are still loaded.

`catalogRows` in the menu repository batches twelve base relations in one database call/snapshot. Image lookups and dynamic branch/sold-out/promotion state are separate fresh reads. No cross-request catalog cache exists. Inner option/modifier subqueries name the tenant and use the existing `menu_items_tenant_status_idx`.

Local workload command: `CATALOG_BENCH=1 pnpm exec vitest run --project server server/features/menu/tests/catalog-performance.test.ts --maxWorkers=2 --reporter=verbose`. It reports returned relation rows, database calls and local p50/p95 over twenty samples. These are SQLite workload measurements, not D1 row-read billing or production latency.

## Fresh counter reads and D1 batch columns

`listCounterQueue(db, actor, now?, automaticCheck?)` loads one context row for the actor's tenant/branch, then one four-statement batch for active orders, lines, payments and finished count. The context combines timezone, the rate at `now`, KHQR settings and token presence without selecting the sealed token. An explicit `automaticCheck` argument remains an internal override; the HTTP route uses fresh token presence. Business-date calculation stays in the existing timezone rules, between context and batch.

Every poll is fresh: two database calls/five SQL statements, excluding access/session resolution. Detail statements use the same active-order subquery and name the tenant, avoiding growing IN lists/chunk calls. The queue has no new cap, and lines are grouped once in placement/line order. Status changes, deadline expiry, rate changes, settings and token changes appear on the next poll. The queue batch is consistent; context is an earlier read. No cache or HTTP response change is implied.

D1 batches return objects keyed by **SQL column names**, whereas individual raw reads and libsql can preserve duplicate names as arrays. Explicitly alias duplicate selected names in joined batch queries, and keep their column decoders. Branch/customer names and catalog add-on own/default min/max fields have distinct SQL names (D170). Regression fixtures model D1's object collapse through the actual Drizzle adapter; a local workerd/D1 probe also checks mapped values.

## Safe structured logs

`log` keeps the request pathname without queries/fragments and masks table/reset/verification token segments. It recursively redacts password/token/cookie/session/authorization/API-key/signature fields, strips URL credentials/query/fragment (including Telegram bot-token paths), and masks common credential assignments/header text in strings. Strings are capped at 4,000 characters, each object/array at 50 entries, and nesting at six levels; cycles and bigint/Error values serialize safely. Trusted context cannot be overwritten by caller fields. This is defense in depth: callers still must not pass bodies or secret values, including opaque free-form secrets the logger cannot recognize.

## Maintenance

`expireIdempotencyKeys(db, now?, limit = 500)` deletes one bounded batch. Its daily task repeats batches for up to five seconds; remaining backlog waits for the next run.

`maintainOutbox(db, { now?, limit = 500, sentRetentionDays = 0 })` returns `{ redacted, removed }`. It scrubs expired verification/reset email payloads (existing 24-hour/one-hour lifetimes), and marks undeliverable expired links failed. Other payloads and active leases are preserved. Positive `sentRetentionDays` opts into removing old sent metadata, one bounded batch per run; zero keeps it. Financial records, audit and failed non-mail work are never removed by this task.

`purgeAssistantUsage(db, now?, limit = 500)`, `purgeDeliveries(db, now?, limit = 500)` and `purgeOrderReadyAlerts(db, now?, limit = 500)` delete one bounded batch; limits must be positive integers and are capped at 500. Their existing cutoffs remain 90 days, 90 days and two days. `drainMaintenance(work, { budgetMs = 5000, batchSize = 500 } = {})` repeats full batches, stops when a page is short or its start-work budget expires, and caps a run at 50 batches. An in-flight query completes; the next scheduled run resumes eligible rows. Notification cleanup reserves 2.5 seconds for each history class to avoid starving customer-alert cleanup.

| Edge case | Behavior | Test |
|---|---|---|
| No length header, chunked input, multibyte text, unused multipart fields | Count bytes before parsing; 413 at the cap | `server/tests/request-body.test.ts` |
| Cloudflare adapter would buffer the whole stream | Entry rejects and cancels it before forwarding to Nitro | `server/tests/worker-body.test.ts` |
| Lease expires and another worker completes | Old success/failure/retry cannot overwrite the newer claim | platform, notification and marketing service tests |
| R2 fails after an asset row is deleted | Key survives and the next purge retries it, including across cafes | media service tests |
| Cafe A generation fails | Cafe B still runs; next page progresses; failed cafe retried next cycle | `server/tests/tenant-jobs.test.ts` |
| Expired account links or large cleanup backlog | Redact only eligible payloads; delete bounded batches | platform `maintenance.test.ts` |
| Reports cover repeated/skipped hours or half-hour DST | Existing timezone library resolves boundaries; dates change at 04:00 local; SQL aggregates bounded rows | orders `report-windows.test.ts`, `reports.service.test.ts` |
| All cafes fail generation; partial progress resumes | Activity/cursor advances while success stays stale; useful work restores health | `server/tests/tenant-jobs.test.ts`, `health.test.ts` |
| Dispatcher stalls with overdue pending work | Optional health threshold detects outbox/notification overdue time across cafes | `server/tests/health.test.ts` |
| Nested/query/provider secrets or recursive log fields | Bounded sanitization preserves useful diagnostics | `server/tests/ids-and-log.test.ts` |
| Two-item cart in a large multi-cafe catalog | One batch; requested cafe/items only; next edit is fresh | menu `catalog-performance.test.ts`, orders quote/placement tests |
| Expired usage/history backlog | Bounded batches preserve newer records and referenced orders | assistant/notification cleanup tests; `server/tests/maintenance.test.ts` |
| Small admin page beside other cafes | Inner price aggregate uses the existing tenant index and preserves ranges/pages | menu `item-list-performance.test.ts` |
| Counter queue grows past a bind-list chunk or expires without a write | Two calls/five statements; all visible orders, ordered details, fresh deadline/settings/rates/count | orders `counter-performance.test.ts` |
| Joined batch selects repeat SQL names | Unique aliases preserve name/date and add-on rule mapping through D1 objects | `server/tests/batch.test.ts`; local workerd/D1 probe |
