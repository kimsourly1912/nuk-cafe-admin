# Cloudflare monitoring baseline — 26 October 2026

Scope: D216, branch `codex/cloudflare-monitoring-baseline` from main `4b681e9`. Read-only analytics and public-page probes; no load test or customer-data query. No new paid subscription, collector, database table or browser dependency.

## What these numbers mean

These are early launch/test observations, not capacity guarantees or invoice totals. Cloudflare's SQL API weights counts and averages on adaptively sampled datasets. Weighted quantiles explicitly use `sampleInterval`. Maximum values describe retained samples only. Do not multiply sampled counts by the sample interval again.

Main metric window: **2026-10-25 15:29:28 UTC → 2026-10-26 15:29:28 UTC** (Cambodia: 22:29 → 22:29). Production was created during this window, so it is not a full day of mature production traffic. Worker wall time is not browser network response time and may include background work. Status mixes include redirects, unknown paths and tests, not just successful checkout/API calls.

## D1

Dataset `events.d1BackendRequest`, scoped to the two Nuk Cafe database IDs.

| Environment | Read queries | Write queries | Rows read | Rows written | Mean recorded batch time |
|---|---:|---:|---:|---:|---:|
| Production | 3,130 | 650 | 66,883 | 3,403 | 0.504 ms |
| Staging | 62,424 | 2,683 | 714,425 | 3,063 | 0.290 ms |

The batch metric is a database observation, not end-to-end browser latency. These observations do not establish a D1 bottleneck. No application query or index changed in this step.

## Worker HTTP invocation observations

Dataset `logs.workersLogs`, `logType = 'cf-worker-event'`, HTTP status greater than zero. Non-HTTP/scheduled records are excluded. Logs are not the billing ledger and static assets can be served without a Worker invocation.

| Environment | Weighted HTTP invocation records | p50 wall time | p95 wall time | p95 CPU | Weighted 5xx records |
|---|---:|---:|---:|---:|---:|
| Production | 930 | 237 ms | 1,121 ms | 281 ms | 0 |
| Staging | 2,550 | 244 ms | 1,149 ms | 275 ms | 40 |

Investigate staging errors by request category before diagnosing an outage: staging is deliberately exercised by deployment and development tests. Do not lower the Worker's CPU ceiling based on this mixed workload; login hashing and other expensive legitimate operations need headroom.

## R2 and browser observations

Dataset `events.r2CombinedOperations`, same main window:

| Bucket | Weighted operations | Sum of reported response-object bytes |
|---|---:|---:|
| nuk-cafe-production-media | 60 | 0 |
| nuk-cafe-staging-media | 570 | 14,487,088 |

Operation counts include multiple operation types; zero reported bytes does not prove an empty bucket or zero storage charge. Cache-hit ratios and billable Class A/Class B totals still need their own views before an image optimization claim.

Dataset `events.rumWebvitalsEvents`: five production observations; p75 LCP **1,484 ms**. The same 24-hour window returned mean TTFB **1,029.2 ms** from five production observations. This sample is too small for a reliable user-experience verdict. Staging returned no RUM rows for that query; that is not a zero-millisecond measurement. INP/CLS and a Cambodia mobile sample remain to collect.

## Analytics installation and privacy

- The existing Web Analytics site is automatically installed on `angder.app`, including its subdomains. Its original single rule covered `*` paths. The live staging menu contained one versioned beacon script.
- The original CSP allowed only same-origin scripts, without the beacon origin. Script presence in HTML is not proof of execution or ingestion; the small existing RUM sample does not prove universal CSP compatibility.
- The beacon source strips query strings/fragments in its URL fields, but records URL paths, referrer paths and Web Vitals paths. Cookie-free analytics is not a guarantee that token-bearing paths are safe to measure.
- D216 allows only the official beacon file/version path on **public menu document** responses. Automatic setup reports to same-origin `/cdn-cgi/rum`; no external collector origin or manual duplicate beacon is added. Other direct page responses retain their original script restriction.
- Token entry documents (`/table/**`, `/reset-password`, `/verify-email`) also receive `Cache-Control: no-store, no-transform`. Cloudflare documents `no-transform` as preventing automatic HTML beacon injection. Referrer policy becomes `strict-origin`, so subsequent requests and documents do not receive the previous full path as the HTTP/document referrer.
- The Free analytics configuration rejected an additional rule (maximum-rule error). Its existing rule was narrowed to `/c/*`; no upgrade was purchased. The API read-back confirms the change, but subsequent live HTML still showed the beacon on synthetic token entry paths. Therefore the native path rule is **not accepted as sufficient proof of exclusion**; the source CSP and no-transform controls must be verified after deployment.
- Direct-document controls do not unload a beacon already running during SPA navigation. Cloudflare can still observe subsequent ordinary SPA paths. Do not describe this as anonymous aggregate-only collection or a universal private-route exclusion. Token-bearing QR links enter as a new document; future internal links to token-bearing paths require a new privacy review. Never add PII, tokens or customer identifiers as analytics dimensions.

## Polling and budget baseline

Source: counter queue and customer tracking refresh at approximately ten seconds while visible/active, with pending-request checks. This step does not change their freshness or replace polling.

Example only: 50 visible screens × 6 polls/minute × 60 minutes × 12 hours/day × 30 days = **6.48 million polls/month**. Actual requests also depend on the active-order bar and other queries. Measure route-level volume before proposing WebSockets.

Workers Paid usage and free services remain the budget boundary. The separate PDF Builder app shares account-level allowances; these app-scoped observations cannot establish total account billing. Querying the existing analytics does not enable Analytics Engine ingestion, Trace collection or new storage/logging products. Existing log sampling is unchanged.

## Independent health monitoring

The existing five-minute GitHub workflow previously skipped without `PLATFORM_HEALTH_URL`. It now defaults to the known production `/api/health`; `PLATFORM_HEALTH_ENABLED=false` explicitly pauses it. A manual run can choose staging without deploying anything. An existing URL override remains supported.

The check requires HTTP 200 and JSON `status: ok`, bounds the body to 4 KB, retries transient curl failures and records request duration in the run summary. It does not print the response body or request URL. Fixture executions of the actual workflow step accepted healthy JSON and rejected unavailable, non-200 and malformed responses. The same step against production passed (one observed duration 7.796 s, including this environment's network path).

Scheduling begins after this workflow reaches main; scheduled GitHub runs can be delayed. Notification delivery uses the repository's existing GitHub notification preferences; no new person, address or Telegram chat was selected. Q24 still requires the owner to verify that a responsible person receives failures. No alert-delivery success is claimed. Standard GitHub-hosted runners are free for this public repository; reevaluate that assumption if visibility changes.

## Repeat the measurements

Discover current fields with the analytics SQL introspection endpoint, scoped to this account. Use `account_tag` in its query parameters if the API requests it, even on the account-qualified route. Never select raw URL queries, cookies, SQL parameter values or customer rows for a performance baseline.

Example queries, using account scope and an explicit time range in the JSON request body:

```sql
SELECT databaseId, SUM(readQueries) AS readQueries,
       SUM(writeQueries) AS writeQueries, SUM(rowsRead) AS rowsRead,
       SUM(rowsWritten) AS rowsWritten, AVG(queryBatchTimeMs) AS avgBatchMs
FROM events.d1BackendRequest
WHERE databaseId IN ('1ba21c84-75fa-4498-aacc-44ea6b53ea95',
                     '33752107-bc40-4c31-8ff0-d3c50dc6a3a2')
GROUP BY databaseId
```

```sql
SELECT scriptName, COUNT(*) AS httpInvocations,
       quantileWeighted(0.5, wallTimeMs, sampleInterval) AS p50WallMs,
       quantileWeighted(0.95, wallTimeMs, sampleInterval) AS p95WallMs,
       quantileWeighted(0.95, cpuTimeMs, sampleInterval) AS p95CpuMs,
       countIf(httpStatus >= 500) AS serverErrors
FROM logs.workersLogs
WHERE scriptName IN ('nuk-cafe-staging', 'nuk-cafe-production')
  AND logType = 'cf-worker-event' AND httpStatus > 0
GROUP BY scriptName
```

## Source validation

Lint, typecheck, 1,986 unit/server tests (one existing skip), staging/production builds and both Wrangler dry runs passed. Generated configs preserve resource isolation and log query redaction. Eleven production-mode HTTP header tests passed initially; removing no-transform in a compiled-policy mutation caused the three token-entry tests to fail.

After restoration, a reuse-only rerun still failed those assertions, and later clean reruns hit local generated-database migration/seed errors and a server-start timeout. No final recovery pass is claimed. Full e2e was attempted but blocked in local setup; Chrome is also absent, confirmed with a direct Playwright launch, and the earlier browser download failed. Existing local database files were preserved and restored. No test-harness, migration or dependency change was made to bypass these issues. Keep the PR in draft pending CI and deployed browser verification.

CI follow-up: PR #189's first run passed all eleven HTTP header tests (shard 1), shard 2, and lint/types/audit/unit. Shard 3 failed one existing counter test's immediate Available-label visibility check. That assertion now uses bounded polling for the same visible state, alongside its unchanged API-state check. See the latest PR checks for rerun results.

## Remaining rollout checks

After merge, confirm the staging menu loads exactly one beacon without a CSP violation, token entry HTML has no injected beacon and preserves no-store/no-transform, and a fresh harmless public-menu visit eventually appears in RUM. Exercise menu → checkout → account navigation and verify that query secrets are absent from collected metadata. Deploy production only through its normal review gate.

Confirm a scheduled health run occurs after merge and a real failure reaches the responsible owner using their existing GitHub preferences. No local full-browser pass, complete RUM rollout, bill projection or alert receipt is implied by this baseline.

Sources: [SQL API functions and sampling](https://developers.cloudflare.com/analytics/sql-api/sql-reference/functions/), [Web Analytics CSP and collection](https://developers.cloudflare.com/web-analytics/faq/), [Web Vitals information collected](https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/), [Web Analytics rules](https://developers.cloudflare.com/web-analytics/configuration-options/rules/), [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
