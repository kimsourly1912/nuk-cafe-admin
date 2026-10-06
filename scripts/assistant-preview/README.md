# Isolated assistant preview (D161)

PR94's same-repository, private-repository CI job deploys the complete Nuxt app to a **separate** preview. It never changes staging's Worker, database, bucket, provider, billing or import flag. Terminal Wrangler credentials are unavailable in the managed workspace; CI uses the already configured staging environment deployment credentials.

- Application Worker: `nuk-cafe-assistant-preview-app`, no public workers.dev or version URL.
- Password gateway: `nuk-cafe-assistant-preview`, forwarding through the supported `APP` service binding. Every request, including assets and public menu pages, requires HTTP Basic authentication. Gateway credentials expire after 24 hours; app Better Auth still independently checks owners/tenants.
- D1: `nuk-cafe-assistant-preview`, `ca2b3f1c-8341-4370-b4f2-bd6b25c1423a`. Only this empty/synthetic database receives the existing migrations and preview owner/category seed.
- Private R2: `nuk-cafe-assistant-preview`. Managed public domain disabled, no custom domains (checked through the authenticated API, 2026-10-06).
- Candidate help: Gemma4, single structured answer; candidate extraction: Scout. Preview enablement is experimental and does **not** satisfy the activation gate.

`prepare.mjs` rewrites only ignored generated Wrangler output, masks newly generated credentials, and writes mode-0600 files under ignored `.data/assistant-preview`. `--secrets-file` deploys secrets with code. No external inference key is used. The CI job never runs for forks, another PR/branch, public repositories or main. Only the deletion-ledger cron is retained; it shares the account's Free cron allocation.

The private repository's `assistant-preview-access` artifact contains **only** temporary preview access credentials and expires after one day. It excludes the deployment token, Better Auth secret, password hash and source documents. Repository readers can use it for review. Never copy its contents into logs, commits or PR descriptions. Download privately from the CI run; use its gateway credentials first, then its synthetic cafe-owner login at `/c/nuk/admin/login`. Prefer synthetic menus while Free CPU remains unverified.

`check.mjs` exercises normal Better Auth sign-in, authenticated image upload/extraction/review/correction/draft/replay/discard, and the PDF supplied-page endpoint. It then runs the existing 26 help cases serially, stopping on the first failure to conserve the free allocation. The results artifact has statuses, timings, rays and quality-check metadata only. It does not contain credentials, uploaded bytes or private/model answer text. Use actual application Worker invocation CPU/outcomes from Cloudflare observability; gateway/helper CPU and wall time cannot certify the Free 10ms budget. A supplied test raster is not a physical-phone/browser-PDF test.

Before release: record full authenticated CPU/outcome evidence, help quality, owner review with a real English menu and a physical phone. Keep staging imports disabled until Free fits. No merge is authorized by preview deployment.

Cleanup after review: discard any private sources, confirm the deletion ledger clears, delete the gateway then application Worker, then the isolated R2 bucket and D1 database using authenticated tools. Do not touch `nuk-cafe-staging*` resources. Redeploying the preview rotates its owner and gateway passwords; expiry revokes access but does not itself delete the resources. Private sources still use the normal 24-hour lifecycle and cleanup ledger.

Official sources checked against Wrangler4.141 / NuxtHub0.10.8 / Nitro2.13.4 / AI SDK7.0.122 / Agents0.26:

- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [secrets deployed with code](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code), [service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).
- [CPU profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/), [Worker limits](https://developers.cloudflare.com/workers/platform/limits/).
- [AI SDK generateText](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text), [createUIMessageStream](https://ai-sdk.dev/docs/reference/ai-sdk-ui/create-ui-message-stream) and installed v7 types/source (current `onEnd`, structured `Output.object`, `include`, cancellation).
- [GitHub secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), [current upload-artifact action](https://github.com/actions/upload-artifact) (v7, one-day retention, explicit single-file paths).
