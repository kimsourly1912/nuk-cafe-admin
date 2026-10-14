# Server performance and security — D169

Authorized on 14 October 2026: fix S2, S3, S4, S7 and S8 from the [server audit](../reviews/server-audit-2026-10-14.md) on a new branch from main. Branch `fix/server-performance-security`, base `9159866` (D168 merged via PR #115). Preserve server-owned pricing, tenant/branch permissions, atomic financial writes, existing retention and current checkout freshness.

| Area | Implementation |
|---|---|
| S2 logs | Pathname-only request context; nested secret redaction; sanitized URL credentials/query/fragment, Telegram token paths and common credential assignments; bounded recursive fields and safe Error/bigint/cycle serialization |
| S3 catalog scope | Explicit tenant predicates inside option-value and modifier subqueries; existing tenant/status index verified by actual query plans |
| S4 job health | Persist activity separately from last useful success, processed count and failures; keep cursor advancement after failures; optional overdue outbox/notification readiness threshold, default disabled |
| S7 cleanup | Bounded 500-row maximum batches for assistant usage, notification history and customer alert requests; resumable loops with time and batch-count budgets; approved retention periods unchanged |
| S8 catalog work | Batch twelve base reads in one fresh snapshot; select cart item IDs for quotes and placement through one JSON bind; all relevant variants/options/modifiers of selected items remain available for validation |

Catalog caching is not introduced: batching and selecting cart relations deliver measurable work reduction with current data on every request. Hours, sold-out state, promotions and final order checks continue to be read. Images and dynamic branch/promotion reads are outside the base snapshot. Queues/realtime/partitioning remain conditional on deployed measurements.

The known Bakong encryption-test mutation is corrected as a test-only verification repair: replacing the first encoded character always changes ciphertext bytes. The encryption implementation and payment policy are unchanged.

## Completion requirements

- Regression cases for nested/query/error log secrets, migration preservation, all-failed versus partial-success jobs, overdue delivery work, bounded cleanup and two-cafe catalog selection.
- Remove each new safeguard and verify regression failures, restoring implementation before final checks.
- Lint, typecheck, unit/server suite, full browser suite for shared server changes, and Cloudflare build validation. No deployment or merge.
- Document actual local workload results separately from production evidence. Update standards, shared server references, progress and current-state navigation.
- Commit changes and prepare a PR for review.

## Operational follow-ups

`NUXT_MAINTENANCE_NOTIFICATION_MAX_AGE_SECONDS` now measures last useful success, not merely cursor activity. Migration `0039_job_success` preserves old cursors with no invented success; allow the configured generation job to run before expecting this optional check to pass.

`NUXT_MAINTENANCE_DELIVERY_MAX_AGE_SECONDS` defaults to `0`. Operators choose a positive threshold when enabling overdue-delivery readiness; future retry times and historical sent/failed work do not count as overdue pending work. No external monitoring setting, account plan, alert destination or billing setting is changed. Q4/Q24 production requirements remain.
