# AI assistant revision: Workers AI and menu import

_2026-10-05. Local adapter/evaluation tooling (D149–D151), disabled sources (D152), image extraction/review backend (D153) and explicit reviewed draft creation (D154); no live model evaluation or activation. D146. Extends [the original phase 9 plan](ai-assistant.md)._

**Visual proposal:** [workflow diagram and desktop/phone frames](ai-assistant-frames.md). Requested by the owner and generated on 2026-10-05; owner approved the desktop/phone layouts as the implementation reference (D148). Use that brief's interaction rules and existing Nuxt UI components; generated images do not approve implementation or establish new styles.

**Design delivery (owner-confirmed, D147):** generate frames and display them directly in chat; do not use Figma or FigJam. Save assets and prompts for handoff. No external-board setup or selection is pending.

## Confirmed direction and status

- **Owner confirmed:** use Cloudflare Workers AI directly through the Worker's `AI` binding, rather than an external AI provider API key.
- **Owner confirmed:** upload a menu image or PDF, review and edit the extracted items, then explicitly **Create drafts**. Publishing remains the existing menu workflow.
- Existing help chat remains owner-only in the cafe's admin workspace. The AI produces suggestions; only an explicit human command saves menu data through the menu feature.
- **[Choice / recommendation, not evaluated]:** start by evaluating `@cf/google/gemma-4-26b-a4b-it` for both help and extraction. Choose the final default after the binding and quality spike below.
- **Owner confirmed (QAI1, D148):** menu import focuses on English only. Existing help-chat language behavior remains separate.
- **Owner confirmed (QAI2, D148):** private source uploads and unsaved reviews expire 24 hours after import creation; reviews survive reload; discard deletes the source and review. This explicitly expands D107's metadata-only scope for import data. Usage logs remain metadata-only.

## Purpose and acceptance criteria

Help cafe owners use the portal and reduce manual entry when moving an existing menu into it.

1. Help chat streams through Workers AI with the same permissions, approved page links, session cleanup and usage accounting as today. Missing binding/settings have an explicit feature-off or configuration-error policy, replacing the present API-key-only switch.
2. An owner can upload a JPEG, PNG, WebP or PDF with no accompanying question and start **Import menu**. The selected cafe is always taken from the route and checked by the server.
3. Extraction proposes names, descriptions explicitly present in the source, source category labels, option/size labels and stated prices. Missing or ambiguous facts remain empty or flagged. It does not invent prices, ingredients or allergens.
4. A review shows the source alongside the proposed rows, permits corrections and exclusion of rows, and identifies missing fields, possible duplicates and unresolved relationships.
5. **Create drafts** saves only selected valid rows, through the existing menu rules. Nothing is published automatically. A retry must not recreate rows that already succeeded.
6. Image menus, text PDFs and scanned PDFs have distinct verified processing paths. Unsupported, encrypted, unreadable or oversized documents get actionable errors; empty extraction is not reported as success.
7. Imported relationships resolve only to this cafe's existing active leaf categories, option sets and add-on groups. Missing libraries are shown for the owner to create or select; the AI does not create them itself.
8. Limits bound file bytes, image dimensions, PDF pages, extracted items, model tokens and concurrent processing. Partial extraction and partial saving are explicit states.

Out of this revision: public/customer AI, counter access, autonomous publication or changes to existing items, saved general chat history, generated dish photos, translated menu fields, automatic creation of libraries, unrestricted document ingestion and large background import jobs. Single-field rewriting remains optional phase 9.3 after import works.

## Model research (checked 2026-10-05)

These are candidates available within Workers AI's free allocation, not unlimited free models. The catalog/pricing must be checked again before release. No candidate has been exercised in this project's Cloudflare account.

| Candidate | Relevant documented capabilities | Recommendation |
|---|---|---|
| `@cf/google/gemma-4-26b-a4b-it` | Vision, multilingual OCR/document understanding, native function calling, 256k context; $0.10/M input and $0.30/M output tokens equivalent | First candidate for one model handling both help and extraction. Native tools fit `link_to_page`; low listed rates fit a modest free budget. Khmer accuracy still needs testing. |
| `@cf/zai-org/glm-4.7-flash` | Multilingual text and function calling, 131k context; approximately $0.06/M input and $0.40/M output | Compare for help and structuring extracted PDF text. It is not the image-reading model. Cheaper input does not prove lower overall cost or better help. |
| `@cf/qwen/qwen3.8-27b` | Vision, reasoning and function calling, 262k context; $0.45/M input and $3.20/M output | Compare on difficult menu images only if Gemma misses important fields. It consumes substantially more budget at listed rates; quality superiority is unverified. |
| `@cf/aisingapore/gemma-sea-lion-v4-27b-it` | SEA-focused text model, 128k context; its publisher describes Khmer training; $0.351/M input and $0.555/M output | Optional Khmer language comparison. Cloudflare does not list vision or native function calling for this hosted variant; it is not a drop-in replacement for the current tool-based help chat. Do not confuse it with the publisher's separate VL model. |

Sources: [Gemma model](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/), [Gemma capabilities](https://developers.cloudflare.com/changelog/post/2026-04-04-gemma-4-26b-a4b-workers-ai/), [GLM](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/), [Qwen](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/), [SEA-LION on Cloudflare](https://developers.cloudflare.com/workers-ai/models/gemma-sea-lion-v4-27b-it/), [SEA-LION publisher](https://huggingface.co/aisingapore/Gemma-SEA-LION-v4-27B), [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [free-plan availability](https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/).

### What free means

- Workers AI includes **10,000 neurons per day**. This is a Cloudflare-account allocation shared by cafes, features and other AI callers, not 10,000 per cafe or user. Workers Free stops serving AI when the allocation is exhausted. Workers Paid includes the allocation, then charges overage; a binding does not eliminate billing.
- The Cloudflare allocation resets at **00:00 UTC (07:00 Bangkok / Phnom Penh)**. The app's current per-owner/per-cafe request counter resets at midnight Phnom Penh. Keep the two limits and their messages distinct.
- Illustration using Gemma's listed rates: 4,000 input + 500 output tokens cost about 50 neurons, or about 200 such single-call requests in the daily allocation. This is arithmetic, not a capacity guarantee: full guides, conversation, images, reasoning, retries and tool steps can use more. Measure actual usage before setting import limits. Do not assume OpenAI's historical 94% prompt-cache result applies here.
- Preserve per-owner/per-cafe accounting, add separate import/page limits, and evaluate a shared deployment budget guard. Reservations and reported/estimated usage must be labelled correctly; token estimates are not an authoritative account-wide neurons balance.
- The app's documented Workers Free CPU failures (Q24, Error 1102) remain a separate constraint. AI inference runs remotely, but PDF rendering/parsing and application work can still exceed Worker limits. R2/D1/other products have separate allowances.

## Binding and SDK integration

- Configure `ai: { binding: 'AI' }` in the generated Wrangler configuration via `nuxt.config.ts`, per deployed environment. Resolve the binding from Nitro's request environment, as the existing rate-limit glue does; inject it for tests. Do not put a token in the browser or use an OpenAI-compatible REST endpoint requiring a token as a substitute for the chosen binding architecture.
- Keep the current AI SDK 7 / Vue chat interface where feasible. Cloudflare's current `agents/models/ai-sdk` provider explicitly supports `ai@^7` / ProviderV4 and `createAI({ binding: env.AI })`, but is **beta**. Spike streaming, tools, structured output, abort handling, bundle impact and Nuxt/Worker compatibility before selecting it.
- Older Workers AI documentation recommends `workers-ai-provider`; do not copy that example without verifying the installed release's AI SDK 7 compatibility. A direct-binding adapter is an alternative only if the SDK integration fails and the tradeoff is documented.
- A provider import does not require adopting the Agents runtime, Durable Objects or persistent chat. Keep the existing feature layers and thin Nitro routes.
- Proposed settings: explicit enablement, provider `cloudflare`, help model and extraction model. Final names and absent-binding behavior are settled in 9.C0 and documented in operations. Models remain server settings, not hardcoded into screens.
- Adding `cloudflare` and an import feature to usage requires updating contracts, schema checks and a **new migration** preserving old OpenAI/Anthropic/Google usage. Do not edit applied migrations or relabel historical records.
- Fix the current quality evaluator's missing `eval-tenant` seed. Separate mock tests from binding-backed, metered quality checks. Fix the hardcoded NUK Cafe identity in the prompt.

Sources: [AI binding](https://developers.cloudflare.com/workers-ai/configuration/bindings/), [AI SDK 7 provider](https://developers.cloudflare.com/agents/models/ai-sdk/), [older provider guide](https://developers.cloudflare.com/workers-ai/configuration/ai-sdk/), [limits](https://developers.cloudflare.com/workers-ai/platform/limits/).

## Document processing

| Input | Proposed processing | Important limit |
|---|---|---|
| Menu image | Send bounded image data to the vision model with an extraction schema and explicit transcription instructions | Preserve readable small prices; do not use the product-photo compression settings blindly. |
| PDF with text | Use the binding's `AI.toMarkdown` conversion, then structure the text with the model; compare source layout when matching prices to names | Multi-column menus can lose associations. Extraction must flag ambiguity. |
| Scanned/image-only PDF | Render selected bounded pages to images, then use the same vision extraction path | The PDF rendering location/library needs a spike; browser rendering is a candidate to avoid Worker CPU costs. No unverified promise of native PDF OCR. |

Cloudflare documents PDF conversion as text/structure extraction, not scanned-page OCR. Its image conversion pipeline uses object detection, resizing and descriptive text generation: that is not the same contract as exact menu transcription. Prefer direct vision extraction for images. Most `toMarkdown` format conversions are free; image conversion can consume AI neurons. Both conversion and schema/model behavior must be exercised with actual sample menus.

Sources: [conversion and pricing](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/), [PDF and image processing](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/), [binding usage](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/binding/).

## Review and creation workflow

1. **Upload:** a dedicated **Import menu** entry on Menu items; the help panel may link to it. An image/PDF alone is sufficient. Show a source preview and PDF page selection before processing.
2. **Extract:** show progress, cancellation and recoverable failures per page. Keep source page/row evidence for names and prices. Model uncertainty is a review flag, not a calibrated percentage.
3. **Review:** edit names, descriptions, leaf category, size/option mapping and price. Show missing fields, ambiguous currencies, unrecognized libraries and possible existing-item matches. Select/exclude items; do not silently overwrite existing items.
4. **Create drafts:** validate selected rows against `createItemSchema` and current menu services. A category is required; missing prices may stay `null` as existing drafts allow. Names max 80, descriptions max 500, at most two option sets; reuse the complete price-grid rules. USD cents are the app's price unit: preserve original currency/amount as evidence and require confirmation before interpreting ambiguous or KHR-only prices. No silent conversion using today's exchange rate.
5. **Finish:** report created, excluded and failed rows separately; retry only failed rows without rerunning extraction. Open an item in the existing editor. Publishing stays explicit and uses current version checks and permissions.

Expanded layout: source preview beside an editable review list. Compact layout: focused upload/page-selection step, review list, one item's editor with source preview available, and a bottom action for the reviewed selection. Use Nuxt UI/Tailwind, shared pickers and unsaved-change guards. The design brief covers empty, processing, partially extracted, uncertain, invalid, quota exhausted, save failure and completion states. New screens follow the mockup workflow; D109's waiver for the original chat is not a waiver for import screens.

Source foundation caps (D152): one source per session, 5 MB per source (the existing upload limit), five live reservations per creator/cafe. Suggested processing caps **[Choice, to verify with live inference]** remain five PDF pages, 50 extracted items and one in-flight extraction per owner/cafe. These are application caps, not Cloudflare limits or commercial plan entitlements.

## Contracts, boundaries and data (source foundation in D152; processing/review proposed)

- New shared import schemas/types live in `shared/contracts/assistant.ts` or a focused assistant-import contract. Strict bounded input; schema-validated extracted output. The extraction DTO is distinct from `CreateItemInput` because unresolved fields are legitimate during review.
- Extraction routes remain under `/api/c/<slug>/admin/assistant/…`, requiring `assistant: ['use']`. Saving additionally requires the existing menu write permission. The actor/tenant comes from access helpers; never a tenant supplied by the file or body.
- Proposed route family: source upload, bounded extraction, source preview/delete, and an explicit reviewed-draft creation command. D152 defines the source-only paths/contracts independently of live inference. Final extraction/review/save paths, schemas and idempotency scope are still written before their implementation; persisted 24-hour reviews are confirmed in D148.
- Extraction code lives in the assistant feature. Menu reads/writes go through the menu's public API. The model has no create/publish/update tools; explicit reviewed saving is application code calling menu commands, not an AI action.
- Reuse `apiFetch`, `useApiQuery` and `useMutation`/its batch behavior; invalidate `products` and affected features after successful creates. Chat retains its documented AI SDK streaming exception.
- Private source documents must not be stored or served as ordinary public product photos. D152 implements source-only persistence/routes behind a disabled switch; review/extraction persistence remains proposed. Approved private storage: source keys live under the tenant in a private import prefix; previews enforce access, and deletion cleans up bytes and metadata. Audit/usage logs exclude document bodies and generated menu text.
- Persisted import/source rows carry `tenant_id`, actor, lifecycle/expiry and enough per-row save tracking to enforce replay safety. Imported menu items keep the normal menu schema. Usage remains metadata-only; import source/review retention is a separate explicit policy (QAI2).
- Budget accounting includes extraction subcalls/pages and retries. A multi-page import is not billed as one cheap help question. Handle Cloudflare capacity/quota errors distinctly from invalid files and save errors.

## First integration change (D149)

Locally implemented: pinned official AI SDK 7 provider, binding adapter, explicit enablement/settings validation, request binding glue, historical-provider-preserving usage migration, safe capacity errors, aborted usage cleanup, neutral cafe prompt and evaluator tenant seed. Verified: full lint/typecheck, 1,216 unit/server tests, 6 assistant browser-mock tests, Worker build plus generated AI binding and unchanged staging-provider inspection. Installed-provider tests use a simulated binding; no live inference or model comparison occurred.

Remaining gate: this environment has no Cloudflare account credentials. Live binding/model quality, neurons/latency and text/scanned PDF strategies are unverified. GitHub authentication is invalid, so no PR could be opened. No deployment/activation occurred. At D149, import storage/APIs, extraction, review screens and draft creation were unbuilt; D152 now adds the disabled source-only foundation. Owner decisions and layouts are approved; the next agent needs integration evidence rather than another product approval round.

## Build order and verification

**Review correction (D150):** official Nuxt/Nitro/NuxtHub/Cloudflare documentation checked against the lockfile. Nitro 2's event binding access is supported; the inline cast is replaced by a shared H3 declaration. AI SDK 7 usage callbacks/evaluator and stream responses use the current APIs. [Reference and regression coverage](../reference/assistant.md#existing-help-and-usage). This does not satisfy the remaining live-model/PDF gate or implement imports.

Each step gets its own reviewable change with progress and decisions updated. This planning task does not authorize deploying or changing the current model.

**9.C0 tooling (D151):** [evaluation runner, synthetic dataset and results](../../server/features/assistant/eval/README.md) now separate offline checks from live binding-backed help/image/text-PDF/scanned/mixed-PDF cases. The local PDF.js browser spike renders text and image-only sources, validates page selection and bounds page count/canvas size. Model transcription, Cloudflare conversion and consumption remain unmeasured. Browser rendering is a locally tested candidate for the future scanned-PDF path, not yet an app/mobile implementation. No production API contracts, source/review storage or import screens are added by the spike.

**Foundation sequencing (D152, owner confirmed):** build the provider-independent private-source backend behind a disabled switch while live 9.C0 checks remain pending. The source contract is now `shared/contracts/assistant-import.ts`: raw upload, private resume/read and explicit versioned discard, five-source/5 MB storage caps, fixed 24-hour expiry and durable cleanup retries. These routes perform no inference or menu writes. This supersedes the earlier requirement to wait for live model evidence before source-only contracts. Processing caps/model choice remain provisional; extraction, review rows/screens and saving still need their own implementation and evidence. [Implemented source API](../reference/assistant.md#private-import-sources-d152).

| Step | Work | Done when |
|---|---|---|
| 9.C0 | Binding/AI SDK 7 and document-processing spike; repair eval harness; compare model candidates | Real binding can stream text, call an approved link tool and return schema-checked menu rows; text and scanned PDF strategies measured; English import results and help-language behavior, neurons/latency recorded. No default model declared proven from documentation alone. |
| 9.C1 | Migrate help chat to the binding, settings/feature switch, usage migration and prompt identity | Existing chat behavior plus missing binding, provider error, quota exhaustion, streaming cancellation and two-cafe isolation verified; local mock versus metered remote setup documented. |
| 9.C2a | Disabled private-source backend (D152); implemented and locally verified, default off | Creator/cafe isolation, bounded upload/resume/read, 24-hour expiry, versioned discard and durable byte cleanup verified; no model calls |
| 9.C2b backend | Disabled image extraction and persisted editable reviews (D153); implemented and locally verified, default off | Strict source evidence, exact-price prefills, private retention, version/lease races, safe failures and accounting locally verified; live release gate stays pending |
| 9.C2b save backend | Explicit reviewed row creation (D154); implemented and locally verified | Same menu rules, atomic receipts/idempotency, explicit duplicate confirmation, partial-success retry, fixed private expiry and bounded writes |
| 9.C2b UI | Approved image review screens/Create drafts button; unbuilt | Mockup reference; library/grid validation, duplicate/replay handling, partial saves, unsaved edits and phone workflow verified; actual sample images evaluated. QAI2 confirmed in D148. |
| 9.C3 | PDF page selection, text conversion and scanned-page vision extraction | Text, multi-column, scanned, mixed, blurry, encrypted and oversized PDFs exercised; partial page failures and budget caps verified against the binding. |
| Later | Text-described drafts and name/description rewriting from original 9.2/9.3 | Separate scope and quality checks; not implicitly included in menu import. |

**Completed backend slice (D153, locally verified/default off):** image extraction and persisted editable reviews under the disabled import switch, before screens and draft creation. `POST imports/{id}/extract` takes the source version; `GET imports/{id}/review` resumes; `PATCH imports/{id}/review/{rowId}` takes the shared source/review version and changes selection or a complete editable draft candidate. The source/creator/cafe and fixed 24-hour expiry stay unchanged. Extracted names, labels, decimal amounts/currencies and evidence remain immutable alongside corrections. Categories/option sets are never invented or auto-created. A separate server extraction-model setting has no default and uses only the AI binding; existing help settings remain independent. One active extraction per creator/cafe, a 60-second inference deadline, a 90-second recoverable lease, no model retries, 50 rows, 20 source prices per row and bounded image dimensions are provisional engineering caps pending live evaluation. Ready reviews cannot be re-extracted and overwritten. PDF extraction remains 9.C3; its upload/resume/discard still works. This slice writes no menu data; mapping validation, duplicates, replay-safe Create drafts and the approved UI follow it. Local mocks do not satisfy the live release gate.

**Explicit draft command (D154):** one selected saved review row per request, UUID Idempotency-Key and shared source version. Reuse the menu planner/guards and atomically append a receipt with menu/idempotency/audit writes. Receipts lock created rows and prevent recreating them after key changes/cleanup. Existing exact English names warn before creation; explicit duplicate confirmation permits intentional duplicates. The UI uses the existing mutation batch engine serially with the latest version, preserving partial successes and retrying only failed rows. Recorded replay versions are snapshots: reload the review after a replay. No UI or inference activation in this backend slice. [Command](../reference/assistant.md#explicit-reviewed-draft-creation-d154).

Quality dataset: existing help questions plus real/synthetic menu images and PDFs covering English labels, multiple columns, currencies, size grids, missing prices and poor scans. Measure item recall, exact name/price association, hallucinated fields, schema validity, links, response language, latency and consumption. Price invention or an incorrect unflagged price is a failed case. Preserve source evidence for human review even after tests pass.

CI never calls a metered model. Server tests use migrations, foreign keys and the D1 parameter cap; include wrong role, wrong cafe, stale library references, replay and quota races. Browser tests verify review, edits, exclusion, partial failures, Stop/Retry and mobile focus. Run lint/typecheck/unit/server and affected e2e; build after config/provider changes. Record mock, real-server, live model and staging evidence separately.

## Handoff and documentation checklist

Current result: confirmed scope plus locally implemented keyless Cloudflare adapter, explicit settings, binding route glue, provider usage migration and installed-provider compatibility tests (D149). The staging build includes an AI binding; deployed inference remains OpenAI. No credentials, deployment or live provider evaluation changed. D151 adds binding-backed evaluation and a measured local PDF spike. D152 adds a disabled creator/cafe-scoped source backend, fixed expiry and durable deletion, authorized independently of live checks. D153 implements disabled image extraction and editable review persistence; D154 adds explicit row draft creation. Screens and PDF extraction are still unbuilt. Model recommendations and processing caps remain provisional; source caps are 5 MB/five live sessions. QAI1/QAI2 and layouts are settled in D148. Next: add the approved review screens and wire the Create drafts button to D154; verify live binding/model/document behavior before activation. Do not activate inference or wire uploads into unrestricted chat from source-foundation tests.

At implementation: update this plan, `docs/progress.md`, `docs/decisions.md`, the original plan/later-options links, server operations/security/data-model where changed, public feature API reference when exports change, and the affected assistant help guides. Update `AGENTS.md` only when agent instructions/conventions change. Actual binding/model configuration becomes documented as current only after implemented and verified.
