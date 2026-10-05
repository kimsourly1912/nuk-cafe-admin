# Assistant server API

The server feature exports through `#server/features/assistant`. Routes use `requireAssistant(event)` for tenant/owner permission checks and request binding resolution; other features must not import its internals. [Operations and activation](../server/operations.md#configuration), [active revision](../plans/ai-assistant-cloudflare.md).

## Settings and model

- `assistantSettingsFrom(raw: RawAssistantSettings): AssistantSettings | null`: `null` means disabled. `cloudflare` requires `enabled: true` or `'true'`, a complete `@cf/vendor/model` id and no base URL. It does not use an API key. Legacy providers preserve key-based enablement when `enabled` is empty; explicit false disables any provider. Enabled incomplete settings throw internal 500 `AI_NOT_CONFIGURED`; the HTTP error handler masks every 5xx as `INTERNAL`.
- `languageModel(settings: AssistantSettings, binding?: CloudflareAiBinding): LanguageModel`: builds the selected SDK model. Cloudflare requires the request's `env.AI` and uses `agents/models/ai-sdk`; missing or malformed binding throws `AI_NOT_CONFIGURED`. It does not make a network call until inference starts. Other providers keep their existing adapters.
- `CloudflareAiBinding` is the installed provider's `AISettings['binding']` type. It is an injected dependency for tests, never returned to the browser.
- `providerFailureMessage(provider: string, error: unknown): string`: safe stream-error copy. Cloudflare status 429 names capacity/allocation and the UTC reset; other failures use the generic unavailable message. Raw provider bodies are not returned.

```ts
import { assistantSettingsFrom, languageModel } from '#server/features/assistant'
import type { CloudflareAiBinding } from '#server/features/assistant'

function configuredModel(binding: CloudflareAiBinding) {
  const settings = assistantSettingsFrom({
    enabled: true,
    provider: 'cloudflare',
    model: '@cf/google/gemma-4-26b-a4b-it', // Evaluation candidate; live quality is still unverified.
  })
  if (!settings) throw new Error('Assistant disabled')
  return languageModel(settings, binding)
}
```

## Existing help and usage

**Binding access (D150):** installed Nuxt 4.5.2 uses Nitro 2.13.4. `requireAssistant(event)` reads `event.context.cloudflare?.env?.AI`, the [documented Nitro 2 binding path](https://v2.nitro.build/deploy/providers/cloudflare#direct-access-to-cloudflare-bindings), after permission checking. `server/types/cloudflare.d.ts` augments H3's request context once; route glue needs no inline assertion. A Node request may have no Cloudflare context, so Cloudflare settings still require the model's missing-binding guard. NuxtHub 0.10 [removed `hubAI()`](https://hub.nuxt.com/docs/getting-started/migration#ai-autorag); do not revive its older helper or copy Nitro 3's `event.req.runtime` API.

**AI SDK 7 streaming (D150):** the service records aggregate tokens from `onEnd({ usage })`, including every tool-call step. The evaluator reads `result.usage`. The chat route passes `result.stream` into standalone `toUIMessageStream({ stream, onError })`, then `createUIMessageStreamResponse({ stream })`. This preserves the browser's SSE protocol, navigation tool parts and safe provider-error copy. `totalUsage`, `onFinish` and result response methods still work as compatibility aliases in v7, but are deprecated; see the [official v7 migration guide](https://github.com/vercel/ai/blob/main/content/docs/08-migration-guides/23-migration-guide-7-0.mdx). `result.finalStep.usage` would count only the last step and must not replace aggregate accounting. Covered by `assistant.service.test.ts` (two-step totals, SSE headers/tools and safe failed streams) and `server/tests/assistant.test.ts` (binding resolution and permission order).

`chatWithAssistant` keeps the approved help guide, validated latest conversation, navigation tool and SDK message stream. Its `StreamHooks` now accepts an optional `abortSignal`; it combines this with the provider deadline. Aborted calls finish the usage reservation as `error`. Cloudflare has no automatic inference retry; legacy retry behavior stays unchanged. Binding cancellation is locally tested; remote client-disconnect behavior still needs a Worker check.

`startUsage`, `finishUsage`, `assistantStatus` and `purgeAssistantUsage` retain per-owner/per-cafe accounting and 90-day metadata-only cleanup. Migration `0032_assistant_cloudflare` adds the provider without relabelling old rows. The app's request counter is separate from Cloudflare's account-wide inference allocation.

At D149, image/PDF import APIs, private source storage and persisted reviews were unbuilt. D152 adds the disabled private-source backend; D153 adds bounded image extraction and editable review persistence. Screens, menu writes and PDF extraction remain pending. D148 confirms their English-only scope and 24-hour retention; do not infer that they exist from the model's image/structured-output compatibility tests.

## Evaluation tooling (D151)

[The evaluation README](../../server/features/assistant/eval/README.md) has the current commands and official sources. `ASSISTANT_EVAL=1` outside CI opens an isolated Wrangler `AI` proxy for Cloudflare and injects it into the existing help service, disposing it after checks; incomplete settings fail rather than skip. Menu evaluation uses strict Valibot-derived structured output and scores actual source associations/uncertainty, with synthetic image/text/scanned/mixed PDF fixtures. `ASSISTANT_SPIKE=1` runs separate local browser PDF checks without inference. The DTO and renderer are private evaluation code, not API contracts or production upload handling. Tokens, conversion estimates and account-wide neurons remain distinct. Live quality/conversion results are still pending Cloudflare access.

## Private import sources (D152)

D152 source foundation, extended by the D153 backend below; no import UI or menu writes. Default `NUXT_AI_IMPORT_ENABLED=false` hides every route. It is separate from help/model enablement. With it enabled, every route requires `assistant:use`, the cafe from the route, and the upload creator. Another cafe or another owner of this cafe sees 404 for a source id.

| Route beneath `/api/c/<slug>/admin/assistant/imports` | Input | Result |
|---|---|---|
| `POST /` | Raw file bytes; exact `Content-Type` JPEG/PNG/WebP/PDF; URI-encoded display `X-File-Name` (≤160 characters, no controls/path separators) | 201 `AssistantImportSource` |
| `GET /` | — | At most five live `AssistantImportSource` rows, oldest first |
| `GET /{id}` | UUID | `AssistantImportSource` for resume |
| `GET /{id}/source` | UUID | Protected bytes, attachment/no-store/nosniff/sandbox headers |
| `POST /{id}/discard` | Strict `{ version }` | `{ cleanupPending }`; access revoked and deletion attempted immediately |

Contracts: `shared/contracts/assistant-import.ts`. Sources are at most 5 MB, MIME signatures must match, and an atomic five-source cap per creator/cafe returns `AI_IMPORT_SOURCE_LIMIT` (429). This is storage admission, not full document decoding or verified PDF page/image dimension limits. Fixed expiry is 24 hours from upload reservation; reading does not extend it. Wrong/missing/expired sources are 404; stale discard is 409 `VERSION_CONFLICT`. A failed storage deletion is retained and retried; `cleanupPending=true` reports that distinction.

Public service exports: `uploadImportSource(db, store, actor, file)`, `listImportSources(db, actor)`, `getImportSource(db, actor, id)`, `readImportSource(db, store, actor, id)`, `discardImportSource(db, store, actor, id, version)`, `purgeImportSources(db, store, options?)` and `assertPrivateImportStorage(store)`; injected `ImportObjectStore` uses NuxtHub FS/private R2 `put/get/del`. Service results expose no object key/public media URL. The task accepts a clock/bounded batch size for testing and logs only deletion/pending counts.

Apply migration `0033_assistant_import_sources` before enabling. [Operations/storage privacy](../server/operations.md#private-import-source-foundation-d152) and [data lifecycle](../server/data-model.md#private-import-sources-d152) explain the durable operational ledger and physical-cleanup delay. No live R2 configuration or model validation has been performed here.

| Source edge case | Handling and coverage |
|---|---|
| A paced chunked body continues after 5 MB on Node | H3 1.15.11 has no cancel handler for its Node bridge. Pause the native request, return 413 with a closing connection, destroy after response finish. Native Web/provided streams cancel normally. `test/e2e/assistant-import.test.ts` checks a paced 8 MB body plus server health; `server/tests/assistant-import.test.ts` checks Web cancellation. |
| Discard occurs during storage read | Recheck visibility after fetching bytes; return 404 rather than the now-discarded source. Service race regression. |
| Byte deletion fails after discard/expiry | Source access is gone; retain the operational ledger and retry. Service failure/recovery regression. |
| User is deleted or tenant source content erased | Cleanup metadata has no cascading identity FK; source content follows normal identity/tenant rules. Service erasure regressions. |

## Image extraction and editable reviews (D153)

Backend slice only, behind the same disabled `NUXT_AI_IMPORT_ENABLED` switch. No UI/Create drafts or PDF extraction. All routes below use the cafe and creator checks above. Apply `0034_assistant_import_review` after 0033. `NUXT_AI_IMPORT_MODEL` has no default and must be a Cloudflare model id; inference uses only the request's AI binding. Help provider/model/key/enablement settings remain independent. A lazy model factory resolves settings/binding after source access/admission, so wrong-cafe sources remain 404 and PDFs report their own unsupported-processing response even without a model. Missing extraction configuration throws before leases/usage; its HTTP 500 is masked as `INTERNAL` by the existing API standard.

| Route beneath `/api/c/<slug>/admin/assistant/imports` | Input | Result |
|---|---|---|
| `POST /{id}/extract` | Strict `{ version }` | `AssistantImportReview`; one bounded image inference then persisted evidence/corrections |
| `GET /{id}/review` | — | Resume `none`, `processing`, `ready` or `failed`; no-store |
| `PATCH /{id}/review/{rowId}` | Strict `{ version, selected?, draft? }`, at least one correction | Whole review with the incremented source/review version |
| `POST /{id}/cancel` | Strict `{ version }` | Cancels the attempt's right to persist; its lease remains until the worker exits or recovery time passes |

`AssistantImportReview` contains `source` (the source DTO/current version/unchanged expiry), `state`, safe `error`, `retryAt` and `rows`. Each server-generated row has immutable `source` evidence, `selected` and an editable `draft`. Evidence preserves names/descriptions/category and size labels, original decimal amounts/currency and literal price text. The model has no tools, tenant/library ids or menu commands. Missing prices/unknown currencies are flagged by the server even if the model omits flags. Schema failures, missing evidence, explicit truncation, non-stop completion and empty/overlong results fail visibly; schema validity does not establish transcription accuracy.

Corrections can remain incomplete: empty name/grid and `categoryId: null` can be saved for resume. A `draft` in PATCH replaces the complete candidate; omitted selection/draft keeps it. Fields use the existing menu contract's option/variation/add-on/availability schemas (`itemVariationSchema` is now exported for this reuse), but relationship existence and full grid validation are deferred to Create drafts. Category/size mapping never creates libraries automatically. Only an unflagged single, unlabelled USD price with exact cents within the menu's price cap can prefill `priceMinor`; no rounding/KHR conversion or ambiguous currency inference. Sizes keep an unresolved grid. Owners still review these suggestions before a future explicit save.

Current engineering caps, pending live quality/CPU/budget evidence: one active 90-second lease per creator/cafe, 60-second inference timeout, 8,192 output tokens, zero retries, 50 items/20 prices each and 64 KB of persisted review JSON. Image metadata must be readable in its first 64 KB, with dimensions at most 8,192 on a side/16 million pixels; this is header admission, not full decoding or a readability guarantee. JSON command bytes are streamed and capped at 64 KB even without Content-Length. One actual image call takes a shared per-owner/cafe daily slot with `feature: menu_import`; failures/cancelled calls still count, and reported tokens are retained even for invalid output. A worker crash can leave pending usage, which conservatively counts for that day. This is not an account-wide neurons budget guard.

Public exports: `importSettingsFrom(raw)`, `extractImportSource(db, store, actor, id, version, () => ({ settings, model }), signal?)`, `getImportReview(db, actor, id)`, `updateImportReviewRow(db, actor, id, rowId, input)` and `cancelImportExtraction(db, actor, id, version)`. Route glue is `assistantImportModel(event)` after access, and bounded `readAssistantReviewBody(event, schema)`. Shared source versions advance at begin, completion/failure, cancel and each edit; always use the latest version for edit/discard. Ready reviews cannot be re-extracted and overwritten.

| Review edge case | Handling and coverage |
|---|---|
| Two extractions race, including different sources | Conditional tenant/creator lease upsert + guarded source update in one batch; loser performs no inference/usage reservation. `assistant-review.test.ts`; lease guard-removal proof. |
| Discard/cancel while a call is running | Source access/result persistence is revoked, but the independent lease blocks another call. Cancellation does not guarantee stopping already-started remote work or refunding usage. Unit race + built-app cancellation API test. |
| A worker dies / an old result arrives during a retry | Lease expires after 90 s; GET reports `AI_IMPORT_INTERRUPTED`. A new attempt replaces the token; late success/failure/release all require their own token. Unit overlapping-worker test and attempt guard proof. |
| Two tabs edit; an edit races with discard/expiry | One shared version and in-batch visibility guards; losing write/audit roll back. Unit race + built-app stale-version tests; version guard proof. |
| A source or review expires / is discarded | Same fixed 24-hour access boundary; source-row deletion erases review JSON and the existing ledger retries object deletion. Unit cleanup + built-app expiry tests. |
| Provider/schema/SQL failure contains source text | SDK telemetry and request/response inclusion disabled; only safe failure codes persist/return. No raw provider or review-write errors are logged. Unit adapter capacity/invalid-output checks. |
| PDF upload is requested for extraction | 422 `AI_IMPORT_PDF_PENDING` before model setup, usage or a call; its protected storage/resume/discard still works. Unit and built-app API checks. |

The real-API review tests seed extraction state in the throwaway SQLite DB. They validate actual permissions, parsing, resume, edits, cancellation and lifecycle, not live AI output. Production model quality, R2 bucket privacy, Worker cancellation/CPU/neurons and the final model choice remain unverified; keep imports disabled.
