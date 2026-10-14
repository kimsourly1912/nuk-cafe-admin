# Architecture reliability — D168

Authorized on 14 October 2026 after the [audit](../reviews/architecture-audit-2026-10-14.md). Implementation branch: `fix/architecture-reliability`, based on main `2877655`. One reliability change for review; preserve the modular monolith and existing product/permission rules.

| Audit area | Implementation |
|---|---|
| A1 body limits | Byte-counted JSON/multipart readers; Cloudflare entry cap before Nitro's buffer; transport and stream tests |
| A2 delivery claims | Owner tokens and conditional settlement for outbox, notifications and marketing; current attempts from atomic claims; stale-success/failure/retry tests |
| A3 dispatch/provider work | Target current tenant/order/kind instead of shared backlog; per-loop budgets, bounded Resend calls, direct tenant lookup |
| A4 R2 cleanup | Durable object keys for provisional uploads and removed source/variant assets; atomic queueing, retry and two-cafe tests |
| A5 tenant jobs | Bounded persistent tenant cursor; per-cafe and per-generation-phase isolation; delivery runs before generation |
| A6 operations/release | Configurable independent GitHub health workflow, optional scheduler heartbeat, exact-revision CI promotion manifest and production runbook |
| A7 database cost | SQL payment aggregates for summary totals and trend windows; preserve report money/counts, timezone boundaries and tenant checks; avoid repeated catalog-array copying |
| A8 lifecycle | Bounded expiry cleanup, redaction of expired account links, opt-in sent-outbox metadata retention |

## Completion requirements

- Lint, typecheck, unit/server suite, affected HTTP/browser tests, production Node and Cloudflare builds.
- Prove new guards by removing them and confirming regression failures; restore before final checks.
- Verify additive migration `0038_delivery_reliability` on the real-migration test database and inspect generated Worker entry/bindings.
- Update server standards, reference APIs, progress/current-state and decision index.
- Open a PR and stop for review. No merge or deployment is included.

## Explicit follow-ups

Production does not yet have an approved domain, account settings or operational policy. Configure `PLATFORM_HEALTH_URL`, recipients, optional scheduler age, Cloudflare exception notifications and production promotion under Q4/Q24; validate them before launch. A checked manifest alone does not enforce a production deployment gate where no production workflow exists.

Sent-metadata retention is `0` until policy is chosen. Guest-account deletion, financial/audit retention, erasure periods, RPO/RTO and the Workers plan remain owner decisions. Expired email-link redaction follows the existing link lifetimes and needs no new retention choice.

Catalog caching, realtime subscriptions, Queues and database partitioning remain conditional on representative multi-cafe measurements. No cache freshness or payment/availability behavior is weakened to save reads. CSP nonces/hashes need a separate SSR-cache design; no exploitable XSS was found in the audit.
