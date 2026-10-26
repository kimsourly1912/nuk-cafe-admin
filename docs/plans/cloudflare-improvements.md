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
