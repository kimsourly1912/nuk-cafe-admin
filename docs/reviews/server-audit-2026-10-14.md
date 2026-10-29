# Server audit — 14 October 2026

> Implementation follow-up: the owner authorized S2/S3/S4/S7/S8 on `fix/server-performance-security`; see the [D169 plan](../plans/server-performance-security.md) and [verification record](../progress.md#server-performance-and-security-d169-2026-10-14). The findings below describe the original `9159866` source, before those changes.

Reviewed revision `9159866`, including D168's reliability implementation. Scope: server entry/middleware/routes, authentication, tenant isolation, queries, payments, providers, jobs, media, migrations, dependencies and deployment configuration. Application code is unchanged.

This is a source and local-test audit. Cloudflare account settings, deployed bindings/metrics, repository protection and live providers were not inspected. No new tenant-data disclosure or payment-integrity bypass was demonstrated in the reviewed paths; this is not exhaustive security certification.

## Priorities

P1 means before production use of the affected feature; P2 means the next server improvement work. Reproduced findings have local probes. Design risks need measurements to establish present impact; launch gaps are existing operational requirements.

| ID | Priority / evidence | Improvement |
|---|---|---|
| S1 | P1 when AI enabled / reproduced | Reject unintended assistant file downloads |
| S2 | P1 / reproduced | Sanitize log URLs and nested secrets |
| S3 | P2 / query plans reproduced | Add tenant predicates to both catalog subqueries |
| S4 | P2; before using job readiness / reproduced | Separate job activity from successful work |
| S5 | P2 / confirmed design risk | Throttle/coalesce KHQR provider checks |
| S6 | P2 / provider-failure risk | Cap Bakong response bytes and validate shape |
| S7 | P2 / confirmed backlog risk | Bound remaining history cleanup |
| S8 | P2 / scaling follow-up | Measure and reduce repeated catalog work |
| S9 | P1 at launch / known gap | Finish capacity, monitoring, release and recovery setup |
| S10 | P2 / reproduced test defect | Fix the encryption test's nondeterministic mutation |

## Findings

### S1. The text help assistant accepts file URLs

Evidence: [assistant.service.ts](../../server/features/assistant/assistant.service.ts), `checkConversation` and `chatWithAssistant`. The SDK's general UI-message validation permits file parts; our checks limit user text but do not reject files. `convertToModelMessages` preserves them. AI SDK `7.0.122` downloads URLs unsupported by the chosen model; provider-utils `5.0.51` defaults to a **2 GiB** download limit. A [Worker isolate has 128 MB of memory](https://developers.cloudflare.com/workers/platform/limits/#memory).

A probe passed a text question plus a `text/plain` URL through the real service. With Worker-style fetch selection and local fetch/model stubs, the SDK fetched the URL and called the model. No large download or actual Worker crash was used. The 64 KB incoming body cap limits the URL, not the remote content. This requires an authorized cafe owner, an enabled AI configuration and a daily usage slot.

Reject file/unsupported parts before reserving usage; permit only the text and known link-tool history the product emits. Strip unnecessary client-supplied provider metadata. Bound total model input, including assistant history, rather than only user questions. If attachments become intentional, use explicit type/host/byte/count/concurrency budgets. The installed SDK validates URLs, redirects and private addresses; no internal-network SSRF bypass was established.

Acceptance: attachment-bearing input causes no download, model call or usage reservation; valid text/tool history still works; excessive assistant history is refused.

### S2. Logs retain query parameters and nested secrets

Evidence: [log.ts](../../server/utils/log.ts), lines 8–20, and [error-handler.ts](../../server/error-handler.ts). H3's `event.path` includes the query string. Redaction examines only top-level field names; exception messages/causes/stacks are arbitrary strings.

A real H3 Web Request probe logged a synthetic verification URL query token and `{ details: { token: 'synthetic-secret' } }`; both survived. This proves logger behavior, not a previously observed real-secret leak. Auth endpoints may use their own logging path; arbitrary query parameters also reach our application routes.

Log only the pathname. Recursively redact structured fields with depth/size limits and serialize errors safely so secret-bearing URLs/headers cannot bypass key redaction. Preserve request IDs, exception classification and useful stack locations. Bound caller-supplied request IDs for deployments without a trusted proxy-generated `cf-ray`.

Acceptance: synthetic query/nested/header/error-string secrets disappear from captured logs while useful diagnostics remain.

### S3. Two catalog subqueries scan other cafes' menu items

Evidence: [catalog.repository.ts](../../server/features/menu/catalog.repository.ts), `activeOptionValues` at line 66 and `activeModifiers` at line 104. Their outer queries filter by tenant; their `IN` subqueries select associations from all active items without a tenant predicate.

Migration-backed SQLite `EXPLAIN QUERY PLAN` showed `SCAN menu_items` in both subqueries. Adding the inner tenant filter changed both to `SEARCH menu_items USING INDEX menu_items_tenant_status_idx (tenant_id=? AND status=?)`. Outer tenant filters and globally unique IDs mean this establishes avoidable platform-wide work, not tenant disclosure.

Add the current tenant to both inner queries and scope link tables explicitly where appropriate. Use the existing index before adding new ones.

Acceptance: two-cafe behavior remains correct; generated SQL includes inner tenant filters; the query plan uses the tenant/status index. Compare deployed rows read for a small cafe alongside many other cafes.

### S4. A healthy heartbeat can hide generation failure

Evidence: [jobs.ts](../../server/utils/jobs.ts), `runTenantPage`; [platform.repository.ts](../../server/features/platform/platform.repository.ts), `saveJobCursor`; [health.get.ts](../../server/api/health.get.ts). The cursor timestamp refreshes even when every tenant's work fails. The optional health check considers only that timestamp for `notifications:generate`.

A probe made every generation attempt throw, received failures, then observed `isJobCurrent(..., 300) === true`. The enclosing notification task subsequently throws and existing job alerts can report it; the failure is missing from this readiness signal. Generation activity also does not establish delivery success or a manageable backlog.

Track last activity, last success, failures and oldest pending age separately. Preserve cursor advancement and per-cafe failure isolation. Decide which sustained conditions affect readiness versus independent alerts; one cafe's transient failure should not take down other cafes. Cover outbox and unpaid expiry as well as notification generation.

Acceptance: persistent failure/backlog is distinguishable from healthy progress, stopped jobs remain detectable, and independent alerts reach the agreed recipient.

### S5. Each unpaid KHQR check calls Bakong again

_Addressed 2026-10-29 by [D222](../decisions.md#d222-one-question-to-bakong-per-qr-every-4-seconds-2026-10-29) (one question per QR every 4 seconds, across Workers); the text below is the original finding._

Evidence: [khqr-check.service.ts](../../server/features/orders/khqr-check.service.ts), lines 40–48, and [rate-limit.ts](../../server/utils/rate-limit.ts). A still-unpaid charge triggers an upstream call on every authorized request. Public/order-placement limits do not cover this counter route. Several cashiers/tabs can duplicate polling; a staff client can call faster than the UI's five-second interval.

Enforce a server cadence and coalesce by tenant/charge, with a short waiting/unavailable-result lifetime if appropriate. Choose freshness/backoff from payment UX and provider limits. Cross-isolate coordination cannot rely on module-local mutable promises. Preserve matching, atomic payment recording, versions, manual confirmation and refund-needed behavior.

Acceptance: concurrent checks produce bounded upstream calls, tenant scopes never mix, and payment detection remains within the agreed delay. No real quota breach was established.

### S6. Bakong response parsing has no byte cap

_Addressed 2026-10-29 on branch `claude/laughing-fermat-cu04no` ([progress](../progress.md#bakong-answers-checked-before-use-audit-s6-2026-10-29)); the text below is the original finding._

Evidence: [bakong.ts](../../server/features/orders/bakong.ts), `checkByMd5`: an eight-second default timeout is followed by whole-body `response.json()`. Duration does not bound bytes. A claimed Content-Length alone would not cover streamed data. Parsed response string fields also need explicit shape validation before use.

Cap actual received bytes, cancel unnecessary non-success bodies and validate the JSON shape. Preserve receiver/currency/amount checks. The upstream is configured and trusted; no oversized real response was observed, so this is provider-failure hardening.

Acceptance: oversized/chunked, malformed and wrong-type responses produce the existing unavailable result without excessive allocation or route errors. Follow [Cloudflare's response-streaming guidance](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

### S7. Remaining cleanup can materialize the full expired backlog

Evidence: [assistant.repository.ts](../../server/features/assistant/assistant.repository.ts), `deleteUsageBefore`, and [notifications.repository.ts](../../server/features/notifications/notifications.repository.ts), `deleteDeliveriesBefore`/`deleteOrderReadyAlertsBefore`. These use unbounded `DELETE ... RETURNING`, collecting every deleted ID only to count rows. D168 bounded other cleanup, but these paths remain unbounded.

Delete bounded eligible ID sets, count affected rows without a large returned result, and resume under a task time budget. Verify expiry indexes/plans. Preserve the approved 90-day usage/history and two-day customer-alert periods. Guest, financial/audit and sent-outbox retention still require existing owner policy; do not guess new cutoffs.

Acceptance: a large backlog drains across runs with bounded writes/results and eligible records only.

### S8. Menu and quote calls reconstruct the complete catalog

Evidence: [catalog.service.ts](../../server/features/menu/catalog.service.ts), `loadCatalog`: twelve catalog reads plus image lookups; [quote.service.ts](../../server/features/orders/quote.service.ts) loads the full public menu to price selected lines. Public-page SWR does not cache quote/API catalog construction. Final order validation should continue using server-owned prices.

Fix S3 first. Measure queries/request, rows read, CPU, response sizes and p50/p95 latency for menu, quote, ordering, counter polling and reports under representative multi-cafe load. Consider a stable tenant catalog snapshot with a revision and explicit invalidation for every relevant mutation. Keep hours, availability, promotions, sold-out state and final checkout validation current. D168 already moved report payment aggregation into SQL.

Acceptance: compare before/after on the same workload; prove cache invalidation and two-cafe isolation. Queues, realtime subscriptions and database partitioning remain conditional on measurements.

### S9. Production readiness still needs operational completion

Evidence: [operations](../server/operations.md), [release-check](../plans/release-check.md), [D168 follow-ups](../plans/architecture-reliability.md#explicit-follow-ups), [platform-health.yml](../../.github/workflows/platform-health.yml) and [nuxt.config.ts](../../nuxt.config.ts).

- The recorded staging release check hit Error 1102 on Workers Free. Current [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time) give Free HTTP requests 10 ms CPU. Profile the actual Worker and settle production capacity/plan before launch. Current account plan/metrics were not inspected.
- Independent monitoring exists but is conditional on `PLATFORM_HEALTH_URL`; recipients, deliberate failure delivery and exception alerts need account/repository verification. App/D1/Telegram alerts depend on the infrastructure they monitor.
- The exact-revision CI manifest exists; a production workflow does not yet enforce its promotion. Finish deployment gating, compatible migrations, backup bookmarks and a restore drill under approved RPO/RTO.
- Resolve existing Q4/Q24 domain/email/retention/recovery/alerts/capacity decisions. Verify auth/QR/encryption secret readiness without printing values.

These are known launch requirements, not newly observed production incidents or authorization to change billing/deployments.

### S10. The encryption test sometimes leaves ciphertext unchanged

Evidence: [bakong-token.service.test.ts](../../server/features/orders/tests/bakong-token.service.test.ts), line 61. It replaces the penultimate character but selects a replacement based on the last character. A penultimate `A` followed by a different last character is replaced by `A`; the encrypted string is unchanged, so decryption correctly succeeds.

Both full baseline runs failed this assertion with 1,440/1,441 tests passing. A focused rerun passed 10/10. A deterministic string probe confirmed the helper returning its unchanged input. This is a flaky regression test, not evidence of an AES-GCM authentication bypass.

Flip a decoded ciphertext byte and re-encode, or choose a different character at the actual position. Assert that decoded bytes changed before checking rejection.

Acceptance: mutation always changes bytes; modified ciphertext is rejected; same-key/wrong-key/wrong-cafe tests remain green.

## Further hardening

- Replace CSP script `unsafe-inline` with hashes/nonces designed together with SSR caching. This existing follow-up has no demonstrated executable XSS in this review.
- Prefer tenant-bearing order/report repository APIs over helpers taking only an authorized branch/order ID. Current services validate ownership first; explicit local scope reduces future reuse mistakes.
- Consider MFA/reauthentication for privileged platform/cafe actions as a separate policy decision, preserving the current product rules until agreed.
- Keep dependency fixes and advisory exceptions reviewed. `pnpm audit --prod --audit-level high` passed with six explicit documented exceptions for development/build dependencies. JSON listed one low, one moderate, four ignored high and two ignored critical advisories. The two unignored esbuild advisories concern development servers. This does not establish an exploitable deployed Worker dependency; inspect the built bundle before changing overrides/exceptions.

## Delivery order

1. Assistant input/download exposure and logging (S1/S2).
2. Catalog subqueries and deterministic encryption test (S3/S10).
3. Job success/backlog monitoring, KHQR cadence, provider caps and bounded cleanup (S4–S7).
4. Production readiness before launch (S9), then measured catalog/load optimization (S8).

## Verification

- Frozen-lockfile install and Nuxt/auth artifact preparation completed without manifest/lockfile changes. The workspace launcher used pnpm 11.19.0 despite declared 12.3.4.
- Two full unit/server runs: 110 files; 1,440 passed and the same flaky crypto assertion failed in each. Focused Bakong rerun: 10 passed. The baseline is not fully green.
- Five temporary probes passed: H3 query/nested-secret logging; current heartbeat after every generation attempt fails; both menu subquery plans before/after inner tenant predicates; assistant URL download using Worker-style fetch selection and local fetch/model stubs; unchanged crypto-test mutation.
- Probe source is saved locally at `/tmp/nuk-server-audit-probes.test.ts`, output at `/tmp/nuk-server-audit-probes.log`. Probes demonstrate findings, not fixes; their temporary repository file was removed.
- Production dependency audit completed. Consulted current Cloudflare docs, Workers types `5.20261014.1` and the installed Wrangler schema.
- No deployed load test/account audit, browser suite, real provider transaction, build/deployment or recovery drill. Only this report and navigation/progress documentation were changed.
