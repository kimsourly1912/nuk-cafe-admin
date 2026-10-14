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

`sendOrderEventsNow(event, { tenantId, orderId }, kind)` sends only that order's matching event, with limit 1; the scheduled outbox run recovers other work. `deliverDue` and `deliverDuePosts` also accept `budgetMs` in their options. Budgets stop additional work, not a running provider request. Resend has a 10-second deadline; Telegram has a 20-second deadline. The immediate order-alert handler starts further notification sends only within a five-second budget.

## Durable media cleanup

Media APIs keep their existing signatures. Before uploading, `media_object_deletions` records provisional keys with a 24-hour grace period. The successful asset batch removes those provisional entries. Crashes and failed compensation leave recoverable deletion work.

Purge and sample-data reset enqueue the source and variant keys in the same batch that removes asset rows. R2 deletion happens afterwards. Successful deletion clears its queue entry; failure leaves the key for a later hourly run. Keys are never reused. The platform purge visits all cafes; per-cafe resets and object operations carry the tenant explicitly.

## Bounded tenant jobs

`runTenantPage(db, job, work, limit = 25)` returns `{ processed, failures: string[] }`. It visits a page of active cafes ordered by ID, catches and logs each cafe's failure, saves progress in `job_cursors`, and wraps to the beginning after the last page. Failed cafes are retried on the next cycle; work must remain idempotent. Overlapping runs can repeat generation safely. The cursor is progress, not an exactly-once claim.

`activeTenantPage(db, after, limit)` and `tenantById(db, id)` are identity public APIs for platform orchestration, without granting permissions to cafe data. `bakongTokenExpiries(db, tenantId?)` can restrict reminders to the current cafe. Notification delivery runs before generation, so failed summaries cannot block existing due alerts. Summary and token-reminder generation also have independent failure boundaries within each cafe.

`readJobCursor(db, job)` / `saveJobCursor(db, job, cursor)` store operational progress. `isJobCurrent(db, job, maxAgeSeconds, now?)` checks its heartbeat. The optional health requirement uses `notifications:generate`; enable it only when Telegram and the cron are configured.

## Maintenance

`expireIdempotencyKeys(db, now?, limit = 500)` deletes one bounded batch. Its daily task repeats batches for up to five seconds; remaining backlog waits for the next run.

`maintainOutbox(db, { now?, limit = 500, sentRetentionDays = 0 })` returns `{ redacted, removed }`. It scrubs expired verification/reset email payloads (existing 24-hour/one-hour lifetimes), and marks undeliverable expired links failed. Other payloads and active leases are preserved. Positive `sentRetentionDays` opts into removing old sent metadata, one bounded batch per run; zero keeps it. Financial records, audit and failed non-mail work are never removed by this task.

| Edge case | Behavior | Test |
|---|---|---|
| No length header, chunked input, multibyte text, unused multipart fields | Count bytes before parsing; 413 at the cap | `server/tests/request-body.test.ts` |
| Cloudflare adapter would buffer the whole stream | Entry rejects and cancels it before forwarding to Nitro | `server/tests/worker-body.test.ts` |
| Lease expires and another worker completes | Old success/failure/retry cannot overwrite the newer claim | platform, notification and marketing service tests |
| R2 fails after an asset row is deleted | Key survives and the next purge retries it, including across cafes | media service tests |
| Cafe A generation fails | Cafe B still runs; next page progresses; failed cafe retried next cycle | `server/tests/tenant-jobs.test.ts` |
| Expired account links or large cleanup backlog | Redact only eligible payloads; delete bounded batches | platform `maintenance.test.ts` |
| Reports cover repeated/skipped hours or half-hour DST | Existing timezone library resolves boundaries; dates change at 04:00 local; SQL aggregates bounded rows | orders `report-windows.test.ts`, `reports.service.test.ts` |
