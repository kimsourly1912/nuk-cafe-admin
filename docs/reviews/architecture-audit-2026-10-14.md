# Architecture audit — 14 October 2026

> Implementation follow-up: the owner authorized fixes on `fix/architecture-reliability`; see the [D168 plan](../plans/architecture-reliability.md) and [verification record](../progress.md#architecture-reliability-d168-2026-10-14). The audit below records the original pre-change findings.

Reviewed repository revision `327e4cd`. Scope: Nuxt rendering and frontend state, Nitro routes and access checks, tenant boundaries, Drizzle/SQLite/D1 writes, payments, outbox delivery, media lifecycle, scheduled jobs, CI and operational readiness. This is a source and local-test audit; no deployed account, production traffic, Cloudflare configuration, branch-protection settings or external payment service was inspected.

## Assessment

Keep the modular monolith. One deployment with feature-owned services/repositories and shared contracts is a suitable architecture for this product. The highest-value work is strengthening resource limits and background processing, then measuring the shared database under representative multi-cafe load. Splitting the customer, counter and admin applications into services now would add distributed failure modes without addressing the defects below.

The foundations worth preserving are:

- Tenant resolution from the URL, authorization through tenant/branch actors, composite tenant foreign keys, and two-cafe service tests.
- Server-owned prices and order transitions; integer money; version guards, idempotency records, audit events and outbox events committed atomically.
- Feature public APIs and enforced import boundaries; thin routes and shared Valibot contracts.
- SSR for public pages, browser rendering for workspaces, session-generation checks, query clearing at identity changes, and preserving displayed data through transient failures.
- Tests built from real migrations, foreign-key enforcement, a simulated D1 parameter limit, and existing HTTP tests for ordering and counter permissions.

No tenant data disclosure was demonstrated in the reviewed paths. This does not establish exhaustive authorization coverage.

## Priorities

P1 = address before real customer use. P2 = address during reliability/scaling work. “Confirmed” means demonstrated locally or directly established by the implementation; “launch gap” identifies an already documented, intentionally deferred capability.

| ID | Priority / evidence | Improvement | Practical effect |
|---|---|---|---|
| A1 | P1 / reproduced | Enforce body limits on received bytes | Prevents requests without `Content-Length` from bypassing the application limit |
| A2 | P2 / reproduced | Give outbox claims an owner and guard completion | Prevents an expired worker overwriting a newer delivery result |
| A3 | P2 / confirmed design | Dispatch only the newly committed events; bound provider work | Reduces shared-backlog contention and background timeouts |
| A4 | P2 / confirmed | Persist R2 deletion work before dropping asset rows | Makes failed object cleanup recoverable |
| A5 | P2 / confirmed design | Isolate scheduled work by tenant and paginate it | Prevents one cafe's failure blocking other cafes' notifications |
| A6 | P1 at launch / known gap | Add independent platform monitoring and a production release gate | Detects failures outside the app's own database/notification path and validates releases |
| A7 | P2 / scaling risk | Reduce repeated catalog/report reads and measure D1 load | Keeps customer requests and reporting from competing excessively on the shared database |
| A8 | P2 / lifecycle gap | Define retention and bounded cleanup across platform tables | Controls database growth and personal-data retention |

## Findings and acceptance criteria

### A1. The request-size limit trusts a header

Evidence: [validation.ts](../../server/utils/validation.ts#L25) checks `Content-Length`, then calls `readBody` without counting bytes. The [image upload](../../server/api/c/[slug]/admin/media/index.post.ts#L15) and [photo upload](../../server/api/c/[slug]/admin/media/photos/index.post.ts#L15) routes use the same header precheck before buffering multipart bodies. Image validation happens after that allocation.

A local H3 HTTP probe sent a chunked JSON body over 128 KB to `readValidBody`, whose advertised cap is 64 KB. A trimmed, short string passed the schema and the request returned **200**. The probe establishes the shared reader's behavior on the local Node adapter; deployed-edge handling of the same request was not tested.

Count received bytes and stop reading at the limit, before JSON or multipart parsing. Keep the header check as an early optimization. Preserve 413 responses rather than converting them into the existing generic JSON-parse 400.

Acceptance: over-limit requests with a normal header and with no length/chunked transfer return 413; valid bodies still parse; multipart limits include extra fields and unused file parts. Verify the built Node server and the Cloudflare adapter.

### A2. Outbox leases have no ownership check when completed

Evidence: [platform.repository.ts](../../server/features/platform/platform.repository.ts#L79) claims with `lockedUntil`; `markSent`, `markRetry` and `markFailed` update by message ID alone. [deliverOutbox](../../server/features/platform/platform.service.ts#L96) also uses one timestamp for the entire loop and takes the attempt number from the earlier list result.

Reproduced sequence: a worker claims attempt 8 and stalls; its lease expires; another worker claims and successfully sends the message; the original worker then fails and changes the already-sent row to **failed**. This corrupts delivery status and can interfere with retry handling. Merely allowing at-least-once delivery does not require allowing stale workers to rewrite current state.

Use a claim token/generation returned by the atomic claim. Require that token and pending state for every completion/retry/failure update. Claim against the current clock and due time, and return the current attempt count from the claim. Bound each provider call so it fits inside the lease, or renew the lease for longer work. Review the analogous notification and marketing delivery loops for the same ownership pattern.

Acceptance: overlap tests cover a live lease, expired lease, stale success, stale failure, and a retry scheduled after another worker's original list read. Only the current claim can finalize a row. Provider-level deduplication remains necessary where available.

### A3. Every order event starts a dispatcher over the shared backlog

Evidence: [sendOrderEventsNow](../../server/utils/outbox.ts#L75) filters only by event kinds. It does not name the request's message IDs or tenant; each placement/payment/ready request can inspect and try to claim up to 25 due events across cafes. The dispatcher processes them serially. [resendSender](../../server/features/identity/identity.mail.ts#L73) has no explicit timeout and reads the complete error body before truncating it. Telegram calls do have a 20-second timeout.

The outbox protects durability, so a canceled immediate dispatch does not by itself lose the committed event. However, unrelated backlogs can delay the new event, concurrent requests repeat scans/claims, and serial provider calls can exceed the HTTP background-work budget.

Pass the committed event IDs into the immediate dispatcher, and leave backlog recovery to the scheduled dispatcher. Add provider deadlines and a bounded total work budget. If measured load exceeds that model, use a queue consumer to wake delivery while retaining the transactional outbox and a recovery sweep; publishing to a queue after a commit alone would introduce a lost-publication window.

Acceptance: placing an order attempts only its own events; an unrelated tenant backlog does not delay them; timeout/retry probes show durable recovery. Track oldest pending age, throughput and terminal failures.

Cloudflare documents a shared **30-second** post-response budget for HTTP `waitUntil` work and recommends Queues for work exceeding it: [execution context](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil).

### A4. Failed R2 deletion loses the durable cleanup reference

Evidence: [purgeExpiredUploads](../../server/features/media/media.service.ts#L205) deletes the database row before deleting objects; failures become `objectErrors`. The [task](../../server/tasks/media/purge-temporary.ts#L7) only logs those errors. The existing media service test explicitly verifies that the asset row is gone when R2 deletion fails. Upload rollback and sample-data cleanup have related best-effort deletion paths.

Keeping database references from pointing at deleted files is correct. The missing piece is a durable record of objects still needing deletion: the next purge cannot find them after the asset row is gone. This causes storage leaks and prevents reliable erasure.

Write object-deletion work into an outbox/tombstone table in the same database batch that removes the asset. Delete R2 objects idempotently with retries, and remove the cleanup work only after success. Periodic R2-to-database reconciliation can catch process crashes during upload, before any asset row exists.

Acceptance: fail an R2 delete, run cleanup again, and show that the object is eventually removed without manual log inspection. Cover photo variants and crashes between object upload and database insertion.

### A5. Tenant scheduling shares one failure boundary

Evidence: [notifications:deliver](../../server/tasks/notifications/deliver.ts#L18) loads all active tenants, processes closing summaries sequentially, then reminders, then sends due deliveries. A thrown error for an early tenant aborts the job before later tenants and the delivery phase. `runJob` records the job failure but does not isolate tenant work.

Use bounded tenant pages and a durable cursor or independent per-tenant work items. Record failures per tenant and continue unrelated work. Run delivery independently of summary generation so a report-generation failure cannot block already-queued alerts.

Acceptance: inject a failure for cafe A; cafe B's reminders and already-due alerts still run. Verify bounded processing and eventual progress when the tenant count exceeds one batch.

### A6. Monitoring and release controls need a production boundary

Evidence: [alertJobFailure](../../server/utils/jobs.ts#L10) depends on the app database and the default cafe's Telegram destinations. API errors use the same database/notification infrastructure. A D1 failure, notification-job failure or Worker failure before the error handler can therefore disable the alert path. Some shared failures are also routed to a customer cafe rather than a dedicated platform destination.

The [CI workflow](../../.github/workflows/ci.yml#L22) deliberately skips checks on pushes to main, and staging deployment has no check-job dependency. This is the accepted solo-development policy in **D133**, which explicitly calls for reconsideration at production. It is a launch gap, not a request to undo that staging decision.

Before production: configure an external uptime check and platform exception alerts; use a platform-owned destination independent of tenant membership/status. Gate production on checks for the exact code released, through up-to-date branch requirements/merge queue or a checked artifact promotion. Preserve staging's faster flow if desired. Include migration compatibility and restore expectations in the release checklist. The repository already records a staging restore drill; repeat it for production's recovery target and configuration.

Acceptance: a database outage and a failed notification job each produce an independent platform alert. An unchecked/stale revision cannot be promoted to production. Resolve the existing Q4/Q24 domain, capacity, recovery and alert-ownership decisions.

### A7. Shared-database load needs a measured budget

Evidence: [loadCatalog](../../server/features/menu/catalog.service.ts#L30) issues twelve base reads plus image lookups per load; the public menu API is uncached. Page-level SWR already reduces public page rendering cost. [reportSummary](../../server/features/orders/reports.service.ts#L55) loads every payment in a permitted range and reduces/groups those rows in the Worker. The contract limits the range to 93 days, but does not limit the number of sales inside it. Counter and customer tracking poll every ten seconds while visible.

These are scaling risks, not demonstrated present-day capacity failures. Keep polling until evidence justifies realtime infrastructure. First measure queries/request, rows read, response sizes and p95 latency for menu, quote, queue and reports under multiple cafes using one database.

Aggregate report totals/trend buckets in SQL. Consider caching the stable tenant catalog with an explicit invalidation/version scheme; keep sold-out state, opening times and checkout validation fresh. Add jitter/backoff to polling if load warrants it. If measured results require push updates, use branch-scoped subscriptions while retaining authorized snapshots and reconnect recovery. Consider database partitioning only after query optimization and measured contention.

Acceptance: establish a representative load scenario and agreed latency/error budgets; compare before/after D1 rows read and Worker time. A report request must not materialize every payment simply to calculate totals. Any catalog cache must invalidate on relevant writes and never cross tenants.

See Cloudflare's [D1 overload guidance](https://developers.cloudflare.com/d1/observability/debug-d1/) and [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

### A8. Retention covers some tables but leaves platform growth undefined

Evidence: scheduled cleanup exists for idempotency keys, assistant usage, notification history and temporary assets. There is no scheduled sent-outbox cleanup. Failed account-email messages retain their payloads, including recipient and one-time URL, because payload clearing happens only on success. Guest accounts are deliberately retained (`disableDeleteAnonymousUser: true`), including guests that never acquire an order. Retention/erasure policy is already open in Q24.

Define retention per data class: financial history, audit, guest identities, successful outbox metadata and failed payloads. Expired account links should not remain indefinitely just because delivery failed. Clean in bounded batches with resumable progress. Preserve referenced financial records; unused guests can follow a separate policy from guests with orders.

Acceptance: old sent outbox records and expired sensitive payloads are cleaned according to policy, retryable messages survive, financial history remains intact, and a large backlog clears across multiple bounded runs.

## Additional improvements

- **Tenant scope in repository APIs:** some order/report helpers take only an already-authorized branch/order ID. Current services validate ownership first and IDs are globally unique, so this is not evidence of a leak. Passing tenant scope into those helpers would make the safety property local and harder to break during reuse. Add HTTP isolation cases as new routes are added; the source-string route checks alone cannot prove permission arguments are correct.
- **Frontend coupling:** `useApiQuery` intentionally relies on Nuxt's synchronous error/data-reset ordering. Its comments document the dependency well. Add a small Nuxt-environment integration test for refresh failure, clear, key change and session change before the next Nuxt upgrade; existing browser coverage remains useful.
- **Security hardening:** the CSP still allows inline scripts, with a comment deferring nonces until SSR, which now exists. Plan nonce/hash support together with SSR caching so cached HTML and policy agree. No exploitable XSS was demonstrated in this audit.
- **Documentation:** the server overview still describes organizations as branches in its feature tree, and some auth comments still say shop writes require verified email despite D156. Update these when changing the affected areas. Keep the current operating model separate from historical decisions so onboarding does not require reading the entire decision log.

## Recommended delivery order

1. Fix A1 and add transport-level regression tests.
2. Fix A2 and A3 together: owned leases, current claim attempts/time, event-ID dispatch and provider deadlines.
3. Add durable media cleanup (A4) and tenant scheduling isolation (A5).
4. Complete the independent monitoring and production release requirements (A6) before real use.
5. Measure shared-database load, then implement the highest-impact query/caching changes (A7); decide retention and implement bounded cleanup (A8).

Queues, realtime delivery and database partitioning are conditional follow-ups to measurements, not prerequisites for keeping this app maintainable. No application architecture decision was changed by this audit.

## Verification performed

- Regenerated Nuxt/Better Auth artifacts with the installed `nuxt prepare`; the initial attempt used stale generated auth files missing `user.isAnonymous` and was discarded.
- ESLint: passed. Nuxt typecheck: passed.
- Unit/server baseline: **105 files, 1,408 tests passed**, after preparation.
- Two temporary audit probes passed by demonstrating the A1/A2 defects. A1 used a real local HTTP request into H3; A2 used the normal SQLite migration-backed test harness with an explicitly advanced delivery time and overlapping workers. These are defect reproductions, not proof of fixes. The probes were removed from the repository; their source is available during this workspace session at `/tmp/nuk-architecture-audit-probes.test.ts` and output at `/tmp/nuk-architecture-probes.log`.
- Used installed binaries directly because the outer pnpm command attempted a noninteractive modules-directory reinstall. No dependency versions or lockfiles were changed.
- Consulted current Cloudflare documentation, current Workers type definitions (`5.20261014.1`) and the installed Wrangler configuration schema. No Cloudflare build/deploy or live API/account inspection was performed.
- Browser e2e, deployed Worker behavior, load tests, query plans on production-sized data and recovery drills were not run for this audit. Findings marked as scaling risks require those measurements.

Application code was left unchanged. Only this report and the progress record were added/updated.
