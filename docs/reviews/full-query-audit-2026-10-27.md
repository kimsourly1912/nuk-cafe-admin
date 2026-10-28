# Full application query audit — 27 October 2026

Implementation follow-up: Q1 is implemented locally as D222 on `perf/customer-order-lookups`, based on newer main `efc2fd7`. The measurements below remain the original `ac1b659` audit; [current validation](../progress.md#customer-order-query-index-d222-2026-10-27) records the new migration and regression results.

Baseline: main [`ac1b659`](https://github.com/kimsourly1912/nuk-cafe-admin/commit/ac1b659c3e91455f91acbccce692214eec706a98), including merged PR #192 / D219. Its staging workflow `40464103489` passed. Audit branch: `audit/full-d1-query-review`.

## Result

There are useful improvements beyond the counter queue. The strongest next work is customer-order reads and their unpaid-order guard, the active-order bar's unnecessary history fetch, report batching, known-cafe notification lookups, and maintenance queries that revisit retained history. Platform lists and very large menu pages also have measurable opportunities.

This report records the original audit and isolated experiments. At that baseline, no application query, migration, database binding, cache policy, retention policy, production data or deployed resource was changed. Candidate indexes exist only inside a disposable local D1. They are not implemented changes ready to deploy.

## Scope and evidence

- Static inventory and review of all **35 app-owned repositories across 13 features**, all 12 feature schema files, generated Better Auth schema/indexes, migrations, shared query/batch/claim/maintenance helpers, and relevant API/service/client callers.
- Checked filters, joins and tenant boundaries, correlated subqueries, aggregates, sort/pagination work, bind-list handling, guard counts, background eligibility and independent reads that could share a batch.
- **19 opt-in experiments** using the installed Drizzle 0.45.3 adapter and Wrangler 4.141.0 local workerd/D1. Full checked-in migrations are replayed; the schema observation has 65 table entries and 176 indexes, including engine/migration-managed entries. The Drizzle snapshot alone lists 63 tables, so those numbers have different scopes.
- Fixture: 250 cafes, 2,000 accounts/memberships, 5,000 completed orders in cafe A and 1,000 in B for the same customer, three active orders for that customer, and 1,999 unpaid orders for other customers. Also 4,000 already-redacted sent email records, 500 menu items/1,500 variants, ten active branches in the final branch experiment, and 500 attached photo sources/1,500 derived files plus one expired source.
- Index comparisons run **after ANALYZE**. These findings do not rely on the cold-plan amplification recorded in D219. Actual `EXPLAIN QUERY PLAN` and D1 `meta.rows_read` are retained in [machine-readable evidence](query-audit-evidence-2026-10-27.json).
- Candidate results are compared with baseline results. The account/cafe and page-pricing prototypes preserve the exercised fixture's output; boundary, race, empty-data and API integration tests are still required before implementation.

`rows_read` is the database's work counter, not a count of distinct customer records, browser response time or a bill estimate. A small-table `SCAN` or a temporary sort is not automatically a defect. No production workload trace, load/capacity test or full third-party Better Auth engine audit was performed. Static coverage is complete for the app-owned repository inventory; dynamic experiments target the paths with the strongest suspected costs rather than every filter combination.

## Ranked findings

| ID | Priority | Area | Measured baseline → prototype | Proposed work |
|---|---|---|---|---|
| Q1 | P1 | Customer order reads and unpaid guard | Active read **6,010 → 14**; guard **6,004 → 2** reported reads | Evaluate one tenant/customer/status/deadline index serving both |
| Q2 | P1 | Customer active-order bar | **4 SQL statements / 3 D1 calls**, including past page and exact count | Give the bar an active-only read; retain the full history API for its page |
| Q3 | P2 | Reports and order detail reads | Summary **8 calls**; a detail read **3 calls** | Batch compatible independent reads; retain context/authorization dependencies |
| Q4 | P2 | Report live counts | **7,003 → 4,004** reads | Reuse D219's active-order predicate/index |
| Q5 | P2 | Customer ready-message cafe lookup | **500 reads / 250 returned cafes → 1 / 1** | Look up the known active cafe instead of enumerating all cafes |
| Q6 | P2 | Expired email payload scrub | **4,005 → 5** reads while changing zero rows | Index the remaining nonempty-payload work, not scrubbed history |
| Q7 | P2 | Temporary photo-source cleanup | **503 → 2** reads to find one expired source | Test a compound eligibility/order index; the partial-root attempt did not help |
| Q8 | P2 | Platform cafe usage summaries | **8,005 → 2,007** reads for two cafes | Count the recent range and seek the latest order using the existing index |
| Q9 | P2 | Platform Accounts page | Page **4,000 → 20** reads; count still **2,000** | Index the default chronological order, keeping exact-count/search limits explicit |
| Q10 | P3 | Large admin item lists | Page query **4,000 → 1,660** reads in an isolated narrowing prototype | Aggregate prices after selecting the item page; prototype excludes page-ID acquisition cost |
| Q11 | P3 | Public branch selector | **21 calls for 10 branches** | Fetch public branch fields and hours in bulk |

P1 means the best first implementation target because it is repeated in a customer journey or a guarded order write. P2 is a demonstrated query/round-trip improvement. P3 is useful at larger feature size or branch count; measure deployment demand before prioritizing it over P1/P2. These are implementation priorities, not security severity ratings.

### Q1. One customer/status index can help both reads and the order-placement guard

Sources: [orders repository](../../server/features/orders/orders.repository.ts), `findCustomerOrdersInProgress` (line 216) and `requireUnpaidAtMost` (line 96).

The active query filters tenant, customer and status, but the existing customer index orders all of that person's historical orders by placement time. The unpaid guard counts matching future-due unpaid rows inside the atomic placement batch; its current plan also walks that customer's history. The fixture includes a second cafe's history for the same account, so a customer-only index still has unrelated work to reject.

An ordinary candidate `(tenant_id, customer_id, status, payment_due_at)` reduced the active read from 6,010 to 14 and the guard from 6,004 to 2, without rewriting their predicates. A separate partial active-customer index plus a literal predicate reached 12 for the active read, but that tiny additional saving does not justify installing both candidates by default. The ordinary index is the stronger first prototype because it serves both queries and preserves bound status values. It stores historical entries; compare that storage/write cost with alternatives before choosing a migration.

**Acceptance:** same list order/limit/status behavior, tenant and customer isolation, two concurrent placements, exact deadline boundaries, and parameter encoding. Keep the unpaid count and idempotency/event/audit writes in their existing atomic batch. Remove the relevant guards and see their existing race tests fail. Test cold and analyzed plans with skewed customer histories before shipping an index.

### Q2. The active-order bar fetches history it never displays

Sources: [ActiveOrdersBar.vue](../../app/features/orders/components/ActiveOrdersBar.vue), [useOrders.ts](../../app/features/orders/composables/useOrders.ts), and [listMyOrders](../../server/features/orders/orders.service.ts) (line 197).

The bar calls `useCustomerOrders({ poll: true })` and uses only `inProgress`. The endpoint also reads a past-order page, its exact total, and line counts. The measured service path issued four statements in three D1 calls, excluding route/session/tenant authorization. In statement start order the fixture reported `[11007,6004,6010,23]` reads. That ordering is an observation of this run, not a stable statement ID.

Polling runs every ten seconds only while an active order exists and the tab is visible. The initial request still runs for a signed-in menu visitor even if no active order is ultimately found. On the full Orders page, refreshing several loaded pages also repeats the active query and total for each page.

**Proposal:** a private, tenant/customer-scoped active-order read for the bar, with only its needed summary fields. Keep the full page/count contract for order history. Coordinate invalidation when an order finishes; do not make old history silently stale or change the existing visibility/pending-request controls. Apply Q1 first or together, so the active-only query also avoids old order history.

### Q3. Independent report and detail reads are still separate database requests

Sources: [reports service](../../server/features/orders/reports.service.ts) and [customer order service](../../server/features/orders/orders.service.ts).

Summary loads branch context and then launches seven independent metric reads with `Promise.all`: eight D1 calls in the fixture, no batch. A preparing-order detail uses three point reads: order, lines and payment. Parallel promises do not combine them into a single D1 batch. They also do not establish one consistent metrics snapshot.

The experiment executed captured reads as a raw D1 batch and compared results in a static fixture. That demonstrates compatibility of the SQL representations, not a finished service implementation or a measured network saving. The summary can target one context read plus one metrics batch. A detail path can at least batch its independent children after the ownership check; do not remove that check to claim a lower call count.

**Acceptance:** current report definitions, integer money, refunds/cancellations, 04:00 business days, previous periods, DST/windows and empty periods. Verify Drizzle's D1 result aliases and timestamp mapping with populated payments and lines. Add a payment-between-reads scenario when moving report metrics into one snapshot. Related item-sales/export and order-history detail paths have the same independent-read pattern and should be covered by this bounded workstream.

### Q4. Report live counts do not yet reuse the merged queue predicate

Source: [currentCounts](../../server/features/orders/reports.repository.ts) (line 96).

The report has its own OR-form active predicate. Replacing it in the prototype with the fixed active-status term plus the existing strict unpaid-deadline rule lets SQLite use the already-deployed `orders_active_queue_idx`. Reported work dropped from 7,003 to 4,004 reads in a branch with 2,002 active orders and 5,000 completed ones. Counting/grouping the active rows still has a cost; this is not a constant-time count.

**Acceptance:** share the owner condition inside the orders feature; do not maintain divergent active-status definitions. Preserve overdue-unpaid exclusion and old preparing/ready orders, branch/tenant scope, and the report's current-day inclusion rule. No extra index is required by this prototype.

### Q5. A ready-message path loads every active cafe to find one

Sources: [notifications.customers.ts](../../server/features/notifications/notifications.customers.ts), lines 87 and 147. This is the earlier follow-up audit's N6, still present on the current baseline.

Both code redemption and the claimed ready-message attempt already know the tenant ID, but call `activeTenants(db)` and search the returned array for its name. With 250 active cafes, the existing read returned 250 rows and reported 500 reads; a primary-key lookup with the active-cafe condition returned one and reported one read.

**Acceptance:** add/use a known-ID active-cafe lookup. Missing and suspended cafes must retain their current suppression behavior; an arbitrary `findTenant` without that condition is not equivalent. Preserve claims, subscription identity, durable retry/catch-up and provider failure handling. Keep whole-cafe enumeration for callers that actually require it.

### Q6. Hourly mail scrubbing revisits already-redacted sent metadata

Sources: [redactExpiredMail](../../server/features/platform/platform.outbox.repository.ts) (line 141), [maintainOutbox](../../server/features/platform/platform.service.ts), and the hourly schedule.

Successful sends clear payloads, but metadata is retained by default (`outboxRetentionDays: 0`). The scrub filters old email kinds/time ranges and then rejects `payload = '{}'`. Its `LIMIT 500` bounds updates, not the work needed to discover that all old rows are already empty. In a fixture of 4,000 such records it changed zero rows but reported 4,005 reads.

A partial candidate on `(kind, created_at, id) WHERE payload <> '{}'` reduced the same empty-work operation to five reads. This does not change email expiry, delivery or retention semantics.

**Acceptance:** expired pending/failed links still lose sensitive payloads; unexpired links, unrelated failed work and live leases stay intact. Compare nonempty/empty payload plans and index-maintenance cost. Do not enable metadata deletion or choose retention periods as an incidental optimization; those remain an owner policy decision.

### Q7. Photo cleanup filters historical attached-source families

Sources: [media schema](../../server/features/media/media.schema.ts), [attachStatement and dueExpiredTemporary](../../server/features/media/media.repository.ts), and [uploadPhoto/purgeExpiredUploads](../../server/features/media/media.service.ts).

Only a photo source's state controls its lifecycle. Its generated files keep their own default `temporary` metadata state, and attaching the source does not rewrite them. The cleanup correctly requires `parent_id IS NULL`; there is no finding that it wrongly deletes those derived files. The cost is in finding eligible roots among retained families.

With 500 attached roots, 1,500 derived rows and one expired root, the existing plan used the parent index and inspected attached roots: 503 reported reads. A partial root-only candidate was **not chosen** and still cost 503; adding it blindly would provide no measured benefit in this fixture. A compound `(state, parent_id, state_changed_at, id)` candidate selected the eligibility/range directly and cost two reads.

**Acceptance:** preserve source-only lifecycle decisions, attached-photo safety, released-source TTL, tenant checks, race guards and durable R2 deletion plans. Benchmark the compound candidate against replacing/extending the existing purge index so variants do not acquire unnecessary duplicate index maintenance. Do not change variant state or delete attached history to obtain the saving.

### Q8. Platform cafe usage computes a recent count while scanning lifetime history

Sources: [orderActivity](../../server/features/orders/orders.repository.ts) (line 417) and [toSummaries](../../server/features/tenants/tenants.service.ts).

A grouped query filters cafe IDs but computes the recent count with `SUM(CASE placed_at >= since ...)` while also computing the lifetime maximum. It must visit old orders to calculate a recent count. A prototype counts only the timestamp range and seeks the latest timestamp separately for each requested cafe, using the existing `(tenant_id, placed_at)` index. For two cafes it reported 8,005 → 2,007 reads with equal populated-fixture values.

**Acceptance:** preserve the exact 30-day cutoff used by the service, latest order across all time, zero-order/unknown cafes and chunked ID handling. This is a query rewrite opportunity, not a reason to add another orders index. The prototype uses explicitly qualified SQL/aliases; production must integrate it through the project's supported query-builder conventions and D1 mapping tests.

### Q9. The platform Accounts page sorts all matching users

Source: [listAccounts](../../server/features/identity/accounts.repository.ts) (line 89).

The default page orders by `created_at DESC, id DESC` with no corresponding index. With 2,000 registered accounts, the page reported 4,000 reads including sorting; a `(created_at, id)` candidate reduced it to 20. The exact total still scans 2,000 rows. A faster page does not make its count free, and high guest proportions or selective kind/search filters can still require substantial scanning.

**Acceptance:** role/kind/search/banned/guest rules, stable ties, pagination and the exact total must remain. Generated auth schemas are not hand-edited: use the supported schema/migration extension path and verify it survives auth schema generation. Test mixed guests/registered accounts and selective searches before deciding whether this index has enough practical value.

### Q10. Large item pages price the full cafe catalog before returning one page

Source: [listItems](../../server/features/menu/items.repository.ts) (line 163).

D170 correctly added the inner tenant scope, so this is not the old missing-scope finding. It still materializes all of the cafe's price ranges. For 500 items/1,500 variations, the page read 4,000 rows and its separate total read 500. Restricting the aggregate to the already-known 20 page IDs reduced the page read to 1,660 with identical rows.

That prototype obtains IDs from the baseline result and **does not include their acquisition cost**. A real implementation should select the filtered/ordered page in a CTE or measure any extra read. Preserve sellable-value logic, all filters/category ordering, delete blockers, range values and the count. Prioritize only if actual cafes have large catalogs; a small menu does not justify unnecessary query complexity.

### Q11. The public branch selector reloads each branch individually

Source: [listPublicBranches](../../server/features/branches/branches.service.ts) (line 118).

After listing branches, the service calls `getPublicBranch` per entry, which rereads the branch and its hours. Ten active branches yielded 21 calls (`1 + 2N`). The current one-branch case has three calls, so this is a bounded fan-out under the existing ten-active-branch rule, not an unlimited tenant scan.

A bulk public-field read plus bulk hours can target two compatible reads. Test the public mapper, archived branches, pauses, time zones, overnight hours, empty branches and two-cafe isolation. Reuse compatible bulk branch/hour reads for closing-summary scheduling if measured minute-by-minute work warrants it. A cache is not required.

## Reviewed patterns to keep, and secondary limits

- **Counter queue:** D219 is present. Keep its fresh four-statement batch, context read, strict deadline behavior and tenant/branch index. This audit does not undo that change.
- **Selected checkout catalog:** twelve base relations already share one batch. The two-item experiment read two items and six variations rather than the full catalog; retain internal item selection, JSON binds and server-side repricing. The availability library can still be read cafe-wide; this is a small-library tradeoff, not proof of global leakage.
- **Membership lookup:** an extra `(organization_id, user_id)` index changed the plan but reported **1 → 1** reads in the exercised 2,000-member fixture. The existing user-ID index already works. Do not add this index just because two equality filters appear together.
- **Staff lists:** current tenant-member/branch semi-joins already address the old global-user-scan finding. Keep one row per person, including duplicate membership handling. Existing owner checks use indexed account existence rather than enumerating every user.
- **Point reads and guarded writes:** primary/composite keys support profiles, tenant/branch/table/charge/settings lookups, idempotency scope and most versioned updates. Option/modifier/library guard counts are scoped to small parent sets. Keep guards inside their batches; this audit is not authorization to remove them.
- **Background delivery:** outbox, notification, ready-alert and marketing due-work readers have eligibility indexes, limits and claim fencing; media object deletion is durably queued. A claim-heavy backlog may still read leased work—measure its composition before adding more write-heavy indexes.
- **Shared lists:** `readPage` already batches page and total; `readInChunks`/JSON selection address bind-list growth. Offset pagination still walks discarded rows at deep pages, and exact counts still scale with matches. A cursor or optional-count response is a product/API change, not a transparent replacement everywhere.
- **Substring search:** `instr(lower(...))` deliberately preserves literal substring/ASCII folding and fixes D1's old LIKE-pattern limit. It can scan candidates; adding a normal B-tree does not turn arbitrary substrings into indexed search. Consider prefix search or compatible FTS only after usage/English/Khmer behavior is agreed and benchmarked. Do not reintroduce the old wildcard/pattern failure.
- **Other source-level opportunities:** the account's cafe switcher resolves logos per cafe; batch these if multi-cafe accounts become common. Public menu branch/catalog/sold-out/promotions and closing-summary reads have remaining independent-call opportunities. They need service-level measurements before a broad shared read API redesign.
- **Small scans are often appropriate:** the local planner scanned a two-row branches table and empty library relations in several experiments. Those are not reasons to create indexes or override SQLite's planner.

## Coverage inventory

The following inventory covers repository query definitions and their schema access paths. “Reviewed” means static query/caller review; dynamic evidence is listed separately above.

| Feature | Repository files reviewed | Outcome |
|---|---|---|
| assistant (1) | [assistant.repository.ts](../../server/features/assistant/assistant.repository.ts) | Tenant/user/day quota guard and indexed bounded metadata retention |
| branches (1) | [branches.repository.ts](../../server/features/branches/branches.repository.ts) | Q11; branch/hour/table reads and active-branch/table guards |
| customers (1) | [customers.repository.ts](../../server/features/customers/customers.repository.ts) | Tenant/user profile primary-key lookup and scoped insert conflict handling |
| identity (4) | [accounts.repository.ts](../../server/features/identity/accounts.repository.ts), [dev-accounts.repository.ts](../../server/features/identity/dev-accounts.repository.ts), [identity.repository.ts](../../server/features/identity/identity.repository.ts), [staff.repository.ts](../../server/features/identity/staff.repository.ts) | Q9; account/staff/membership reads, owner/eligibility guards, development-only resets |
| marketing (3) | [marketing.links.repository.ts](../../server/features/marketing/marketing.links.repository.ts), [marketing.posts.repository.ts](../../server/features/marketing/marketing.posts.repository.ts), [marketing.repository.ts](../../server/features/marketing/marketing.repository.ts) | Channel/code/post lookups and indexed due-post claiming; no additional confirmed index need |
| media (2) | [media.objects.repository.ts](../../server/features/media/media.objects.repository.ts), [media.repository.ts](../../server/features/media/media.repository.ts) | Q7; asset/variant lookups, attachment and expiry guards, object deletion queue |
| menu (9) | [availability.repository.ts](../../server/features/menu/availability.repository.ts), [catalog.repository.ts](../../server/features/menu/catalog.repository.ts), [categories.repository.ts](../../server/features/menu/categories.repository.ts), [items.repository.ts](../../server/features/menu/items.repository.ts), [modifiers.repository.ts](../../server/features/menu/modifiers.repository.ts), [options.repository.ts](../../server/features/menu/options.repository.ts), [promotions.repository.ts](../../server/features/menu/promotions.repository.ts), [reset.repository.ts](../../server/features/menu/reset.repository.ts), [soldout.repository.ts](../../server/features/menu/soldout.repository.ts) | Q10; catalog, item/category/option/modifier/rule links, sold-out, promotions and reset guards |
| notifications (4) | [notifications.customers.repository.ts](../../server/features/notifications/notifications.customers.repository.ts), [notifications.deliveries.repository.ts](../../server/features/notifications/notifications.deliveries.repository.ts), [notifications.links.repository.ts](../../server/features/notifications/notifications.links.repository.ts), [notifications.repository.ts](../../server/features/notifications/notifications.repository.ts) | Q5; destination/rule overview batch, deliveries, customer-ready claims and connect codes |
| orders (3) | [khqr.repository.ts](../../server/features/orders/khqr.repository.ts), [orders.repository.ts](../../server/features/orders/orders.repository.ts), [reports.repository.ts](../../server/features/orders/reports.repository.ts) | Q1–Q4/Q8; orders, reports, KHQR; queue and payment integrity boundaries retained |
| platform (4) | [platform.audit.repository.ts](../../server/features/platform/platform.audit.repository.ts), [platform.jobs.repository.ts](../../server/features/platform/platform.jobs.repository.ts), [platform.outbox.repository.ts](../../server/features/platform/platform.outbox.repository.ts), [platform.repository.ts](../../server/features/platform/platform.repository.ts) | Q6; audit paging, idempotency, outbox due/health/retention, cursor/job upserts |
| sample-data (1) | [sample-data.repository.ts](../../server/features/sample-data/sample-data.repository.ts) | Tenant/run primary-key lease and guarded reset state |
| support (1) | [support.repository.ts](../../server/features/support/support.repository.ts) | Tenant grant/history and session/tenant visit reads; bounded recent grant relation |
| tenants (1) | [tenants.repository.ts](../../server/features/tenants/tenants.repository.ts) | Q8; slug/current/former lookup, active cursor, global platform counts and logo fan-out |

Schema review includes all twelve feature schema files plus generated Better Auth identity/account/session/member/verification/rate-limit tables. Shared review includes `query.ts`, `batch.ts`, `claims.ts`, `maintenance.ts`, request access/tenant resolution, schedule/cursor orchestration and the repeated client polling callers. Standard auth token/email/account indexes were inspected; all third-party internal query combinations were not dynamically profiled.

## Suggested delivery order

1. **Customer query indexing (Q1).** One orders-focused PR; compare index shapes, cold/analyzed/skewed plans and write overhead. Financial guard, tenant and concurrency tests are mandatory.
2. **Active-only customer bar (Q2).** Separate API/client PR; keep the order-history contract and completion refresh behavior.
3. **Report read batch and shared active counts (Q3–Q4).** Preserve time/money definitions, populated D1 mapping and a concurrent status/payment scenario. Include other report/detail batching only while scope remains reviewable.
4. **Known-cafe notifications (Q5).** Small independent PR with suspended/missing-cafe and durable delivery tests.
5. **Maintenance eligibility (Q6–Q7).** Separate bounded PRs as needed. Measure index write/storage cost, retain object deletion and lease guards, and leave retention policy unchanged.
6. **Platform read paths (Q8–Q9).** Separate query rewrite/index PRs, including zero-history cafes and mixed account kinds. Monitor their actual use before prioritizing over customer paths.
7. **Large-catalog/branch optimizations (Q10–Q11).** Complete production-shaped prototypes only if actual size/frequency warrants the extra complexity.

Each step should record before/after SQL work, current output parity, two-cafe cases and relevant boundary/race tests. Measure deployed staging route latency/rows read after merge; a local row-read reduction does not guarantee an equal user-visible speedup. Use the existing D1/Workers setup, without introducing a cache or changing checkout/order truth.

## Reproduce and validation

```bash
QUERY_AUDIT=1 corepack pnpm vitest run --project server server/tests/full-query-audit.test.ts
```

This opt-in test rebuilds a disposable local D1, records the evidence JSON and drops every candidate index with that database. It does not call production APIs, send messages, read customer data or operate R2. Without `QUERY_AUDIT`, it is skipped. Node 24.22.1 and pnpm 12.15.0 are used; versions and query behavior are tied to the checked-out lockfile.

Audit execution passed with all 19 experiments, including unchanged-result checks for the candidate queries. Final lint/typecheck and regression evidence are recorded in [progress](../progress.md#full-application-query-audit-2026-10-27). This task does not change runtime code, so a new deployment or full UI build is not needed to validate the audit report. No implementation PR or deployment is implied by these findings.

Primary technical references checked for this audit:

- [Cloudflare D1 indexes, query plans and index write/storage tradeoffs](https://developers.cloudflare.com/d1/best-practices/use-indexes/)
- [D1 concurrency/throughput and batching guidance](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
- [SQLite partial-index implication rules](https://www.sqlite.org/partialindex.html)
- [SQLite EXPLAIN QUERY PLAN interpretation](https://www.sqlite.org/eqp.html)

Recommendations above are inferences from source review and the linked local experiments. They are not claims about which route currently dominates production traffic.
