# Live Cloudflare validation and fixes (D159, 2026-10-06)

The image/PDF upload → private review/correction → explicit unpublished Create drafts workflow is implemented (D152–D158). **Activation is held.** The owner explicitly chose Workers Free and asked to keep imports disabled until CPU fits. Staging still uses OpenAI / `gpt-5.4-mini`, without a deployed AI binding or import settings. No app deployment, billing change, migration application or existing menu/source mutation occurred.

## Changes

- Use documented Agents 0.26.0 `reasoningEffort: null` for Cloudflare models. In live Gemma calls, default thinking exhausted the answer budget or extraction deadline. Disabling thinking produced a real binding-backed answer within the cap.
- Send bounded names without the unanchored nonblank regex that collapsed live Gemma names to `%`. Keep the original strict nonblank-name/evidence/truncation validation before saving reviews. A counterfactual restoring the transmitted regex makes the regression fail; original bytes restored and checks pass.
- Explicitly require unknown currency and null price evidence when no price is printed. This fixed Scout's incorrect currency on the missing-price item across PDF rasters.
- Image evaluation now invokes the production extractor and review validator. The runner covers eight production vision cases and two separate experimental full-document text conversions; the spike DTO cannot prove production compatibility.

## Live results

The private validation Worker used the installed AI SDK 7.0.122 / Agents 0.26.0, a real `AI` binding, compatibility date matching staging, and actual production helpers. HTTP service-binding calls ran one case per invocation; serial dispatch, D1 one-run/per-case claims and absolute deadlines prevented recurring inference. Public worker URLs/previews were disabled. Menus are the checked-in synthetic fixtures; text/scanned/mixed PDFs were rendered locally through installed PDF.js into bounded PNGs.

| Model | Evidence | Release conclusion |
|---|---|---|
| Gemma 4 26B A4B | With thinking off but the original name regex: 0/8 menu cases; 22/26 help cases, all four required navigation-button cases failed. After the name fix: 3/7 completed menus passed, two timed out and two failed transcription associations; eighth prevented from dispatch. | Reject as the current default. Native REST also printed tool syntax as answer text. |
| Llama 4 Scout | Initial 5/8 menu cases passed; three PDF cases assigned a currency to a missing price. With the clarified rule, **8/8 passed**, preserving names, descriptions, columns, sizes, currencies, missing-price flags and source-instruction rejection. Final inference latency **4,426–9,804 ms**. | Best tested import candidate: `@cf/meta/llama-4-scout-17b-16e-instruct`. Synthetic accuracy is proven; full app performance/real-menu/device gates remain. Keep model unset in deployed settings. |
| GLM 4.7 Flash | **17 completed help cases: 15 passed, two failed** (missing category-conversion step and opening-hours timeout). Approved links worked in completed navigation cases, sometimes repeated across steps. Dispatch stalled on the next question; remaining cases unverified. Worker was superseded, then deleted. | No passing full help suite; do not select/activate it yet. A separate REST probe also printed malformed tool syntax. |
| Llama 3.3 70B fast | One native REST guide/question probe returned a valid `link_to_page` call. | Comparison candidate only; full binding help/Khmer suite and cost not verified. No vision. |
| Qwen3 30B A3B FP8 | One native REST probe returned answer/tool text in reasoning fields without usable answer content or a tool call. | Probe only, not an installed-binding quality result or a selected model. |

See [sanitized machine-readable results](results.json). No source bytes, full provider bodies, API keys or customer documents are included. Metrics contain SDK-reported tokens, **not** authoritative neurons per test.

## Resources and privacy

Baseline Gemma HTTP helpers used **6–218 ms CPU**. Final Scout helpers (eight imports plus smoke) used **6–17 ms**; completed GLM help cases used **6–265 ms**. These omit real session/origin/cafe authorization and app D1 quota/review/draft work. Successful outcomes can use isolate burst flexibility; they do not prove sustained compliance with Workers Free's **10 ms** limit. Profile authenticated app endpoints and steady load before release; do not enable based on helper timings.

Account analytics observed **104 requests / 6,622.1893 neurons**, 779,376 input and 19,737 output tokens, approximately 01:40 UTC. This is an account-wide snapshot with ingestion lag, not a guaranteed balance or solely this feature's cost. Free AI stops beyond 10,000 neurons/day at 00:00 UTC. No paid plan/overage was enabled. Cloudflare returned its Free-plan five-cron limit during isolated setup.

The staging R2 bucket had r2.dev disabled and no custom domains on recheck. A dedicated private service-bound helper put/read/compared bytes and MIME/deleted/head-checked **one owned 30,769-byte synthetic object** under the private import prefix; deletion succeeded. This verifies binding CRUD, not the application's authenticated HTTP source routes.

Temporary resources were removed: AI-validator cron cleared; `nuk-cafe-ai-validation-d159-20261006` and `nuk-cafe-r2-validation-d159-20261006` deleted; their one-run D1 database deleted. Account lists confirmed none remained. Existing staging Worker, settings and three scheduled tasks were preserved; no new public route or secret remains.

## Local verification and remaining release gates

Full lint/typecheck, **1,453 unit/server tests in 102 files**, **65 focused provider/review/evaluation tests**, six existing chat browser checks and six offline PDF-render spike checks pass. Thinking-budget and transmitted-name guard counterfactuals fail as expected, then pass after restoration. The staging Worker builds at **8.57 MB / 2.21 MB gzip**; generated AI binding, off/unset imports, existing OpenAI model, migration 0035, five-minute source cleanup and exclusion of executable PDF parsing/native canvas/evaluation code were inspected. Lazy same-origin PDF assets remain. Local default-heap build failed with OOM; retry with `NODE_OPTIONS=--max-old-space-size=6144` passed. No dependency/configuration/schema changes.

Still required before activation:

1. Workers Free CPU on actual authenticated chat/upload/extraction/review/draft routes, under steady load; live cancellation and stalled-stream/deadline behavior.
2. A passing full help/approved-link/Khmer suite for the selected help model. Do not treat the GLM partial run as 26 passing checks.
3. Real English menu samples and physical phone checks. Previous responsive Chromium screenshots are browser evidence, not physical-device evidence.
4. Owner review and the existing PR/CI/migration/deploy workflow. No merge or activation is implied by this validation.

## Official sources checked before changes

- [AI SDK binding provider](https://developers.cloudflare.com/agents/models/ai-sdk/) (updated 2026-10-02; Agents 0.26.0 / AI SDK 7, documented reasoning option) and [Workers binding example](https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/).
- [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/) (updated 2026-09-14). The name-regex behavior is observed live, not a documented general prohibition on regex schemas.
- [Gemma](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/), [Scout](https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/), [GLM](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/), [Llama 3.3](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/) and [Qwen3](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/).
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and [paid-only models](https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/).
- [Multipart Worker metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/), [service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/), [cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) and [R2 binding API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), with current official connector API schemas for upload, schedules, deletion and telemetry.
- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) and latest retrieved Workers types 5.20261005.1; repository dependency versions unchanged.
