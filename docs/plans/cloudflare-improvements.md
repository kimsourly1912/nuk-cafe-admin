# Cloudflare improvements within the existing plan — D215

Authorized by the owner on 26 October 2026: improve security, performance and reliability using the existing Workers Paid subscription and free services. The $5 monthly charge is a minimum, not a cap. Do not enable additional paid subscriptions. Account usage is shared with other apps; monitor included allowances and overages before promising a monthly total.

## Steps

One branch/PR per step. Existing tenant permissions, guarded writes, payment idempotency, guest checkout and the release process remain authoritative.

| Step | Scope | Completion evidence |
|---|---|---|
| 1 | Domain security and automatic log query redaction | Zone settings read back; DNSSEC chain verified or propagation explicitly pending; staging/production builds and Wrangler dry runs preserve isolation and redaction |
| 2 | Monitoring, privacy and usage baseline | Browser analytics works with CSP; API/CPU/D1/R2/polling measurements; health check activation and alert destination resolved with the owner |
| 3 | Turnstile and targeted API abuse controls | Server token validation; form recovery; shared Wi-Fi rush test; Telegram, health checks and callbacks remain usable |
| 4 | Public image delivery | Measured cache hits and fewer storage reads; private originals protected; replacements and errors handled correctly |
| 5 | Measured D1 query improvements | Actual query plans and before/after work; freshness, tenant isolation and financial guards preserved |
| 6 | Recovery and account-email verification | Controlled staging recovery drill; real verification/reset delivery and retry observations; production recovery policy remains Q24 |

### Step 1: domain security and log privacy

Branch `codex/cloudflare-security-baseline`, based on main `44b8d7788be62ef7dd78fe48e9e49aaf068210c7`. The latest main CI succeeded before work started.

Targets for the shared `angder.app` zone:

- DNSSEC signed and registrar DS chain published. Cloudflare is the registrar; it manages DS publication, which can take one to two days. `pending` is not proof of a complete chain. Do not remove signing while a DS remains at the parent.
- Minimum TLS 1.2; TLS 1.3 stays enabled. Always Use HTTPS enabled. Full (strict) aligned with the intended baseline; SSL mode concerns origin connections, not an extra origin server for our Worker.
- Existing HSTS/CSP headers retained. Rocket Loader and Bot Fight Mode remain off (D214).
- `observability.redact_query_string: true` in both environment builds. This covers automatic request URL query metadata, separately from the app's redacted logger. It does not redact path segments, message bodies, custom console text or historical logs.

Keep log sampling and retention unchanged in this step. No new paid service, data migration or business behavior change. The source change must survive later deployments; a live settings change alone is not the source of truth.

### Step 2: monitoring, privacy and usage baseline (D216)

Step 1 merged in PR #188 with successful main CI/staging deployment. Step 2 branch `codex/cloudflare-monitoring-baseline`, based on main `4b681e9`. [Baseline](../reviews/cloudflare-monitoring-baseline-2026-10-26.md), [progress](../progress.md#cloudflare-monitoring-baseline-d216-2026-10-26).

Reuse free automatic Web Analytics with a public-menu document CSP allowance and same-origin reporting. Token entry documents receive no-store/no-transform; referrers omit paths. Narrow the existing Free rule rather than purchasing more rules. API read-back did not prove injection exclusion, and an already loaded beacon can observe later SPA paths: validate the deployed boundaries before calling browser analytics complete.

Record app-scoped Worker/D1/R2/RUM measurements before optimizing. Enable the existing independent health workflow by default on production after merge, with staging selectable manually and an explicit pause switch. Validate HTTP status and JSON, bound output/retries, preserve existing notification preferences. Actual failure receipt and Q24's responsible owner remain open. No new subscription, collector or dependency; no polling, SQL or cache freshness change.

### Step 3: account bot protection (D217)

Owner authorized the next step after PR #189 merged; main `1611b28` CI/staging passed. Branch `codex/cloudflare-bot-protection`.

- **[Choice] Surfaces:** email/password sign-in (customer/admin/counter/platform), sign-up, password-reset requests and verification-email resends. Stable actions: sign_in, sign_up, password_reset, verify_email. Existing Better Auth handlers remain authoritative; verify before password work/account email. Guest ordering, 2FA, OAuth, password-reset token redemption, health and Telegram are outside this challenge scope.
- **[Choice] UI:** an on-demand browser-check modal using the existing AppModal, after form validation. Cancel/Back preserves the form and sends no request. Retry after script/network/expiry failure. Each attempt creates/removes its own widget; no token persists between requests. No new screen/layout redesign or dependency.
- **[Choice] Server:** reuse Better Auth's before hook with canonical Siteverify, strict success/action/exact hostname validation, 2048-character token cap and ten-second deadline. Native captcha options provide one expected action per plugin; this hook preserves distinct endpoint actions and safe failure handling without duplicating auth handlers. Missing configuration and upstream failures fail closed when enabled.
- **[Choice] Environments:** separate free managed widgets; no pre-clearance or paid product. Exact frontend hostname comes from each environment's site URL. Local/e2e remains disabled by default; test fixtures never become production bypasses. Public keys in configuration, secrets only in existing Worker secret bindings.
- **[Choice] API limits:** preserve current limits, check exact order-placement matching and verify public/shared-connection behavior without a load test or real order/payment mutation. Existing low per-IP auth/guest caps remain a known shared-Wi-Fi constraint; this step does not promise 50 concurrent sign-ins or a new capacity policy.
- **Acceptance:** reject missing, forged, expired/replayed, wrong-action and wrong-host tokens; preserve successful auth/email/2FA flows; cancellation, retry and script failure work; correct CSP; unrelated routes stay unchallenged; guard-removal checks fail. Real browser/token/replay verification is required on deployed staging before calling rollout complete.
- **Rollout:** one PR; main deploys staging, production remains behind its normal manual reviewer gate. Document every unverified item rather than silently disabling protection.

### Step 4: public image edge delivery (D218)

Branch `codex/cloudflare-public-image-cache` from merged main `a486b7e`; PR #190's staging deployment succeeded (run `40432803581`). Reuse Workers Cache API and the existing private R2 binding, without a new subscription, public bucket, image transformation service or dependency.

Only canonical HTTPS GETs for `/media/menu/<key>.<jpg|png|webp>` and `/media/t/<tenant>/menu/<key>.<jpg|png|webp>` are eligible. A complete origin and tenant path identify each entry. Query-bearing, authorization, conditional and range requests stay on the existing read path. Ordinary session cookies do not fragment these deliberately public bytes and never enter stored keys.

Successful bounded image responses keep the existing one-year immutable browser policy; edge copies expire after one hour. Photo edits already create new keys (D158), so replacements do not wait for expiry. Only representation headers are stored: current Nitro security headers and request ids still run on each request. Errors, redirects, private sources, non-images, Set-Cookie, Vary and partial responses are never stored. Cache failures fall back to NuxtHub; writes use the request's `waitUntil`.

The cache is per data center, not a globally replicated or tiered cache. A hit skips NuxtHub's R2 body and metadata reads; it still invokes the Worker. Concurrent cold requests may each read R2. Removing an object does not revoke already downloaded browser copies; an old edge copy can remain for up to an hour. The existing browser lifetime is unchanged. Do not describe object deletion as immediate cache revocation.

Completion requires focused cache/tenant/replacement/failure tests, the real HTTP photo journey, a Workers-runtime cache check, environment builds/dry runs and post-merge staging MISS/HIT checks. [Evidence](../progress.md#cloudflare-public-image-delivery-d218-2026-10-27), [operations](../server/operations.md#public-image-delivery-d218).

### Step 5: measured D1 counter queue (D219)

Owner authorized the next step after PR #191 merged. Branch `codex/cloudflare-d1-query-performance` from main `e2b5380`; staging deployment run `40444162955` passed. [Measurement](../reviews/cloudflare-d1-queue-2026-10-27.md), [evidence](../progress.md#cloudflare-d1-counter-queue-d219-2026-10-27).

Add the partial `orders_active_queue_idx (tenant_id, branch_id, placed_at, id)` for active statuses, and use its fixed literal status predicate in all three active counter reads. This skips finished history while retaining fresh reads, deadline checks, earlier-day active orders, stable ordering, tenant isolation and the existing batch. No polling/cache policy, financial write or paid service changes. Migration `0049_orders_active_queue` is additive and runs before the Worker through the existing deployment process. Account for index storage and transition writes; keep the old indexes.

Compare actual local D1 plans and rows read with the old predicate, both before and after ANALYZE; statistics can already make the old query cheaper. Do not infer a universal speedup from a cold-plan fixture. Require boundary/tenant/freshness tests, mutation checks, standard checks and full CI browser tests before review. Verify staging migration and representative D1/route measurements after merge. Production's manual gate remains.

## Owner security checklist (D244)

Settings outside the repository, done by the owner in the Cloudflare and GitHub dashboards. All free on the current plans; no new subscription (D215). Record each one's date and what was read back in [progress](../progress.md#security-hardening-ci-pinning-no-v-html-staging-access-d244-2026-10-31); an unchecked box is not done. Dashboard paths move: follow Cloudflare's current docs if a name differs.

**Accounts (first: whoever holds these holds everything below, the backups included)**

- [ ] Cloudflare, GitHub and the email inbox behind them: two-step sign-in with an **authenticator app**, not SMS; unique passwords in the password manager; nobody else invited.
- [ ] The CI Cloudflare token (`CLOUDFLARE_API_TOKEN`): still limited to this account and the `angder.app` zone; give it an expiry date and a reminder to replace it before then.
- [ ] GitHub → Settings → Actions → General → **Workflow permissions: Read repository contents**. (Each workflow already asks for read only, D244; this covers a workflow that forgets.)
- [ ] GitHub → Settings → Rules (or Branches): `main` requires a pull request and the CI checks; the `production` environment keeps its required reviewer.

**Domain**

- [x] DNSSEC: *pending* on 2026-10-26 (D215); reported working by the owner on 2026-10-30 ([progress](../progress.md#owner-checks-smoke-test-release-hand-check-dnssec-production-setup-2026-10-30)).
- [ ] Security Center → **Security Insights**: read the findings. Don't turn on Bot Fight Mode because of one (D214).
- [ ] Security → WAF → Managed rules: the **Cloudflare Free Managed Ruleset** is on. Afterwards a deploy's smoke check and Telegram still pass (the D214 lesson).
- [ ] Email: `_dmarc.angder.app` moves to `p=quarantine`, then `p=reject` once the DMARC reports show only Cloudflare Email Sending's mail passing. A **CAA** record allowing only the certificate authorities Cloudflare uses for the zone (SSL/TLS → Edge Certificates shows them).
- [ ] Page Shield / client-side security (Security → Client-side security, if the Free plan lists it): turn on script monitoring. Needs verification on this plan; skip if it isn't offered.

**Staging behind Cloudflare Access** (Zero Trust free for up to 50 users)

Order matters: the CI change (D244) must be merged first, or the next staging deploy's smoke check fails.

1. Zero Trust → Access → Service credentials → **Service Tokens** → Create: name `github-staging-smoke`, a duration with a reminder. Copy the Client ID and Secret (shown once).
2. GitHub → Settings → Environments → `staging` → secrets `STAGING_ACCESS_CLIENT_ID` and `STAGING_ACCESS_CLIENT_SECRET`.
3. Zero Trust → Access → Applications → **Self-hosted**, domain `staging.angder.app`, policies: **Allow** the owner's (and testers') emails; **Service Auth** with the service token.
4. Two more self-hosted applications, `staging.angder.app/api/webhooks/telegram` and `staging.angder.app/api/health`, each with a **Bypass / Everyone** policy: Telegram and a manual Platform health run on staging can't sign in.
5. Check: merge or re-run a staging deploy (its smoke check passes); a private browser window at `https://staging.angder.app` asks for Access; Telegram to `@nuk_cafe_bot` still answers.

To undo: delete the three Access applications (staging is public again); the secrets can stay.

## Verification and rollback

1. Read the current zone and Worker settings, preserving nonsecret before/after evidence.
2. Build each environment separately and inspect its generated Wrangler config for redaction, own D1/R2/rate-limit namespaces, domain, disabled preview/worker origins, existing crons and email binding.
3. Validate each build with Wrangler's dry run. Run the repository's lint, types, audit and unit/server checks; attempt browser checks and report environment blockers explicitly.
4. Read live settings back after an authorized infrastructure change. Check HTTPS health for production and staging, HTTP redirects and DNSSEC via a validating resolver. An API setting read-back does not prove successful browser behavior or log ingestion.
5. With a harmless synthetic query marker on staging, inspect only that invocation's URL metadata and confirm the marker is absent after redaction. Do not use a real reset or OAuth token. Record this as pending if logging access or probe delivery is unavailable.

For a connection regression, revert the affected zone setting to the captured previous value and recheck both hostnames. Redaction can be reverted independently without modifying code, bindings or secrets, then reconciled with this configuration. Do not change DNSSEC and DS records out of order; use the [DNSSEC rollback procedure](https://developers.cloudflare.com/dns/dnssec/#roll-back-dnssec).

## Deferred work

Later steps need their own implementation evidence. Turnstile is free but changes form behavior and CSP. WAF limits depend on the Free website plan; preserve D214 and check the real tenant-prefixed paths. Public caching must not include sessions, checkout, payments, personal orders, protected originals or API errors. The existing menu SWR and client query reuse already provide caching; avoid stacking stale intervals.

Production Telegram binding readiness is separate from purchasing infrastructure. No bot token/name appeared in the production metadata during this review; resolve whether that integration should be active before testing real delivery. Q24 still owns alert recipients and recovery targets. D1 Time Travel does not restore R2 objects or Worker secrets.

## Official references

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [DNSSEC and registrar DS publication](https://developers.cloudflare.com/dns/dnssec/)
- [Minimum TLS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/minimum-tls/)
- [Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/)
- [Worker observability configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#observability)
- [Worker settings API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/)

Implementation and live evidence belong in [progress](../progress.md#cloudflare-security-baseline-d215-2026-10-26).
